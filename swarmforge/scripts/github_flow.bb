#!/usr/bin/env bb
(ns github-flow
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.java.shell :as shell]
            [clojure.edn :as edn]
            [clojure.string :as str]
            [cheshire.core :as json])
  (:import [java.nio.channels FileChannel]
           [java.nio.file StandardOpenOption OpenOption]))
(def script-dir (fs/parent *file*))
(load-file (str (fs/path script-dir "project_runtime.bb")))
(defn now [] (str (java.time.Instant/now)))
(defn fail! [message] (throw (ex-info message {:http-status 409})))
(defn state-file [project] (fs/path (project-runtime/host-dir project) "state.edn"))
(defn state [project] (project-runtime/read-edn (state-file project) {:issues {} :batches []}))
(defn enabled? [project] (true? (:github-enabled (project-runtime/config project))))
(defonce monitors (atom {}))
(defn locked [project f]
  (let [dir (project-runtime/host-dir project)]
    (when-not dir (fail! "GitHub integration requires a forge project"))
    (fs/create-dirs dir)
    (locking (get (swap! monitors #(if (contains? % (str dir)) % (assoc % (str dir) (Object.)))) (str dir))
      (with-open [channel (FileChannel/open (.toPath (java.io.File. (str (fs/path dir "lock"))))
                           (into-array OpenOption [StandardOpenOption/CREATE StandardOpenOption/WRITE]))
                lock (.lock channel)]
        (f)))))
(defn active-batch [s]
  (last (filter #(not (#{:merged :rejected} (:status %))) (:batches s))))
(defn save! [project s]
  (project-runtime/write-edn! (state-file project) s)
  ;; Read-only scheduling input by convention, not a security boundary. The
  ;; authoritative approval/publication record stays outside the agent mount.
  (let [batch (active-batch s)]
    (when (fs/sym-link? (fs/path project ".swarmforge"))
      (fail! "Project state directory must not be a symlink"))
    (project-runtime/write-edn! (fs/path project ".swarmforge/batch-gate.edn")
      {:enabled true :batch (:id batch)
       :cards (if (and (= :running (:status batch)) (not (:error s)))
                (mapv :name (:cards batch)) [])}))
  s)
(defn config! [project]
  (let [{:keys [repository validation-command poll-seconds] :as cfg} (project-runtime/config project)]
    (when-not (re-matches #"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+" (or repository ""))
      (fail! "Configure repository as owner/repo"))
    (when (str/blank? validation-command) (fail! "Configure validation-command before enabling GitHub integration"))
    (when-not (and (integer? poll-seconds) (<= 10 poll-seconds 86400))
      (fail! "poll-seconds must be between 10 and 86400"))
    cfg))
(defn gh [& args]
  (let [p (process/process (into ["gh"] args) {:out :string :err :string})
        result (deref (future @p) 60000 ::timeout)]
    (when (= ::timeout result)
      (process/destroy-tree p)
      (fail! "GitHub request timed out; retry reconciles any completed remote operation"))
    (project-runtime/checked result)))
(defn gh-json [& args] (json/parse-string (apply gh args) true))
(defn git [project & args]
  (str/trim (project-runtime/checked
            (apply project-runtime/run project "git" "-c" "core.hooksPath=/dev/null"
                   "-C" (str project) args))))
(defn host-git [dir & args]
  (str/trim (project-runtime/checked
            (apply shell/sh "git" "-c" "core.hooksPath=/dev/null" "-c" "core.fsmonitor=false" "-C" (str dir) args))))
(defn board [project]
  (let [f (fs/path project ".swarmforge/board/tasks.tsv")]
    (if (fs/regular-file? f)
      (mapv (fn [line] (let [[name lane] (str/split line #"\t")]
                         {:name name :lane lane}))
            (remove str/blank? (str/split-lines (slurp (str f))))) [])))
(defn issue-snapshot [issue]
  (select-keys issue [:number :title :body :updated_at :state :html_url :labels]))
(defn card-snapshot [project card]
  (let [file (fs/path project ".swarmforge/board" (str (:name card) ".txt"))]
    (assoc card :description (when (fs/regular-file? file) (slurp (str file))))))
(defn listed-issues [cfg]
  (let [query (str "repos/" (:repository cfg) "/issues?state=open&per_page=100&labels="
                   (java.net.URLEncoder/encode (:issue-label cfg) "UTF-8"))
        pages (gh-json "api" "--paginate" "--slurp" query)]
    (into {} (for [issue (mapcat identity pages) :when (not (:pull_request issue))]
               [(:number issue) (issue-snapshot issue)]))))
(defn eligible? [cfg issue]
  (and (= "open" (:state issue))
       (some #(= (:issue-label cfg) (:name %)) (:labels issue))))
(defn poll-state [s latest]
  (let [batch (active-batch s)
        frozen (:issues batch)
        changed (for [[n snapshot] frozen :when (not= snapshot (get latest n))] n)
        assigned (set (mapcat #(keys (:issues %)) (:batches s)))
        seen (set (concat (:seen-issues s) (keys (:issues s))))
        fresh (remove #(or (seen %) (assigned %)) (keys latest))]
    (cond-> (assoc s :issues latest :seen-issues (into seen (keys latest)) :last-poll (now))
      (seq changed) (assoc :error (str "Approved Issues changed or became ineligible: " (str/join ", " changed)))
      (seq fresh) (assoc :pending-notify (vec (sort (distinct (concat (:pending-notify s) fresh))))))))
(defn poll! [project]
  (let [cfg (config! project) s (state project)
        latest (listed-issues cfg)
        ;; Fetch previously observed issues too, so closing/removing labels is
        ;; distinguished from pagination omissions and API failures.
        known (into latest (for [n (keys (:issues s)) :when (not (contains? latest n))]
                             [n (issue-snapshot (gh-json "api" (str "repos/" (:repository cfg) "/issues/" n)))]))]
    (save! project (poll-state s (into {} (filter (fn [[_ issue]] (eligible? cfg issue)) known))))))

(defn propose! [project cards]
  (locked project
    #(let [cfg (config! project) s (state project)
           existing (active-batch s) rows (into {} (map (juxt :name identity) (board project)))
           numbers (set (mapcat :issues cards))]
       (when existing (fail! "Finish or reject the current batch before proposing another"))
       (when-not (and (vector? cards) (seq cards)
                      (= (count cards) (count (distinct (map :name cards))))
                      (every? (fn [c] (and (= "waiting" (:lane (get rows (:name c))))
                                          (seq (:issues c)) (every? pos-int? (:issues c)))) cards))
         (fail! "Each batch card must name a unique waiting card and nonempty Issue numbers"))
       (doseq [n numbers]
         (when-not (eligible? cfg (get-in s [:issues n])) (fail! (str "Issue is not eligible: " n))))
       (let [batch {:id (str "batch-" (java.util.UUID/randomUUID)) :status :proposed
                    :cards (mapv (partial card-snapshot project) cards)
                    :issues (select-keys (:issues s) numbers) :created-at (now)}]
         (save! project (update s :batches conj batch)) batch))))
(defn update-batch [s batch]
  (update s :batches (fn [xs] (mapv #(if (= (:id %) (:id batch)) batch %) xs))))
(defn managed-files [project]
  (or (:files (project-runtime/read-edn (fs/path (project-runtime/host-dir project) "managed.edn") {}))
      (let [paths (str/split (git project "ls-files" "-z" "--" "swarmforge" "mission.md" ".gitignore") #"\u0000")]
        (vec (remove str/blank? paths)))))
(declare excluded?)
(defn sync-upstream! [project cfg target]
  (when-not (zero? (:exit (shell/sh "git" "check-ref-format" (str "refs/heads/" target))))
    (fail! "Invalid target branch"))
  (let [mirror (fs/path (project-runtime/host-dir project) "upstream.git")
        bundle (fs/path (project-runtime/host-dir project) "upstream.bundle")
        guest-bundle (str "/tmp/swarmforge-upstream-" (java.util.UUID/randomUUID) ".bundle")]
    (when-not (fs/exists? mirror)
      (fs/create-dirs mirror) (host-git mirror "init" "--bare"))
    (host-git mirror "fetch" "--no-tags" "--no-recurse-submodules"
              (str "https://github.com/" (:repository cfg) ".git")
              (str "refs/heads/" target ":refs/heads/swarmforge-target"))
    (host-git mirror "bundle" "create" (str bundle) "refs/heads/swarmforge-target")
    (if (project-runtime/sandboxed? project)
      (project-runtime/checked (shell/sh "sbx" "cp" (str bundle)
                                (str (project-runtime/sandbox-name project) ":" guest-bundle)))
      (fs/copy bundle guest-bundle))
    (try
      (git project "fetch" "--no-tags" guest-bundle "refs/heads/swarmforge-target")
      (let [sha (git project "rev-parse" "FETCH_HEAD")
            worktrees (->> (str/split-lines (git project "worktree" "list" "--porcelain"))
                           (keep #(when (str/starts-with? % "worktree ") (subs % 9))))]
        (doseq [wt worktrees]
          (when-not (str/blank? (project-runtime/checked (project-runtime/run project "git" "-C" wt "status" "--porcelain" "--untracked-files=no")))
            (fail! (str "Commit or resolve outstanding changes before starting a batch: " wt)))
          (project-runtime/checked (project-runtime/run project "git" "-c" "core.hooksPath=/dev/null" "-C" wt "merge" "--no-edit" sha)))
        sha)
      (finally (project-runtime/run project "rm" "-f" guest-bundle)))))
(defn approve! [project id]
  (locked project
    #(let [cfg (config! project) _ (poll! project) s (state project) b (active-batch s)
           target (or (:target-branch cfg) (:default_branch (gh-json "api" (str "repos/" (:repository cfg)))))
           remote (str "https://github.com/" (:repository cfg) ".git")]
       (when-not (and (= id (:id b)) (= :proposed (:status b))) (fail! "No matching proposed batch"))
       (when (:error s) (fail! (:error s)))
       (when-not (= (:cards b) (mapv (partial card-snapshot project) (:cards b)))
         (fail! "Proposed card content changed; reject and propose the batch again"))
       (when (some (fn [row] (not (#{"waiting" "done"} (:lane row)))) (board project)) (fail! "Wait for existing pipeline work to finish"))
       (when (seq (git project "status" "--porcelain" "--untracked-files=no")) (fail! "Commit project changes before approving a batch"))
       (let [base (sync-upstream! project cfg target)
             start (git project "rev-parse" "HEAD")
             b (assoc b :status :running :base base :target target :remote remote
                      :start start :managed (managed-files project) :approved-at (now))]
         (when (seq (remove (partial excluded? (:managed b))
                           (remove str/blank? (str/split-lines (git project "diff" "--name-only" base start)))))
           (fail! "Project has unpublished product changes outside this batch; integrate them before approval"))
         (save! project (update-batch s b)) b))))
(defn reject! [project id]
  (locked project
    #(let [s (state project) b (active-batch s)]
       (when-not (and (= id (:id b)) (= :proposed (:status b))) (fail! "Only a proposed batch can be rejected"))
       (save! project (dissoc (update-batch s (assoc b :status :rejected)) :error)))))
(defn gates-clear? [project]
  (let [roots (cons (fs/path project) (when (fs/directory? (fs/path project ".worktrees"))
                                       (fs/list-dir (fs/path project ".worktrees"))))]
    (not-any? (fn [root]
                (some (fn [rel]
                        (let [dir (fs/path root ".swarmforge" rel)]
                          (and (fs/directory? dir)
                               (some fs/regular-file? (fs/glob dir "**")))))
                      ["handoffs/outbox" "handoffs/inbox/new" "handoffs/inbox/in_process"
                       "handoffs/pending_approval" "handoffs/delivery_attention"
                       "board/lt-allow-pending" "dashboard/clarifications/pending"])) roots)))
(defn ready? [project b]
  (let [rows (into {} (map (juxt :name :lane) (board project)))]
    (and (= :running (:status b))
         (every? #(= "done" (rows (:name %))) (:cards b)) (gates-clear? project))))
(defn publication-dir [project b]
  (fs/path (project-runtime/host-dir project) "publications" (:id b)))
(defn pr-for [cfg branch]
  (first (gh-json "pr" "list" "--repo" (:repository cfg) "--head" branch "--state" "all"
                  "--json" "number,url,state,mergedAt,headRefOid")))
(defn excluded? [managed path]
  (or (contains? (set managed) path)
      (some #(or (= path %) (str/starts-with? path (str % "/")))
            ["swarmforge" ".swarmforge" ".worktrees" "tasks" "tmp"])))
(defn publish! [project]
  (let [cfg (config! project) s (state project) b (active-batch s)
        dir (publication-dir project b)
        branch (str "swarmforge/" (fs/file-name project) "/" (:id b))]
    (when-not (and (not (:error s)) (ready? project b)) (fail! "Batch is not ready to publish"))
    (let [final (git project "rev-parse" "HEAD")
          managed-changes (apply git project "diff" "--name-only" (:start b) final "--"
                                 (distinct (concat ["swarmforge" "mission.md" ".gitignore"] (:managed b))))]
      (when-not (str/blank? managed-changes)
        (fail! (str "Managed paths changed during the batch; review before publication: " managed-changes)))
      (when-not (str/blank? (git project "status" "--porcelain" "--untracked-files=no"))
        (fail! "Project has uncommitted changes; finish the handoff before publication"))
      (when (and (:source-sha b) (not= final (:source-sha b)))
        (fail! "Source changed after the publication checkpoint; inspect the retained publication before retrying"))
      (when-not (fs/exists? dir)
        (fs/create-dirs (fs/parent dir))
        (project-runtime/checked (shell/sh "git" "-c" "core.hooksPath=/dev/null" "clone" "--no-checkout"
                                          (:remote b) (str dir)))
        (host-git dir "checkout" "-b" branch (:base b)))
      (when-not (:published-sha b)
        (when-not (= (:base b) (host-git dir "rev-parse" "HEAD"))
          (fail! "Publication checkout changed before its checkpoint; inspect it before retrying"))
        (let [paths (remove #(excluded? (:managed b) %)
                            (remove str/blank? (str/split (git project "diff" "--name-only" "-z" (:start b) final) #"\u0000")))
              patch (when (seq paths)
                      (project-runtime/checked
                       (apply project-runtime/run project "git" "-C" (str project) "diff"
                              "--binary" "--full-index" "--no-ext-diff" "--no-textconv"
                              (:start b) final "--" paths)))]
          (when-not (seq paths) (fail! "Batch has no product changes to publish"))
          (project-runtime/checked (shell/sh "git" "-c" "core.hooksPath=/dev/null" "-C" (str dir)
                                            "apply" "--index" "--binary" "-" :in patch))
          (host-git dir "-c" "user.name=SwarmForge" "-c" "user.email=swarmforge@local"
                    "commit" "-m" (str "Complete " (:id b)))
          (let [sha (host-git dir "rev-parse" "HEAD")
                b (assoc b :published-sha sha :source-sha final :branch branch)]
            (save! project (update-batch s b)))))
      (let [s (state project) b (active-batch s)
            validation (str "/tmp/swarmforge-validate-" (java.util.UUID/randomUUID))
            archive (fs/path (project-runtime/host-dir project) "validation.tar")
            guest-archive (str "/tmp/swarmforge-validation-" (:id b) ".tar")]
        (when-not (:validated-at b)
          (host-git dir "archive" "--format=tar" (str "--output=" archive) (:published-sha b))
          (if (project-runtime/sandboxed? project)
            (project-runtime/checked (shell/sh "sbx" "cp" (str archive)
                                      (str (project-runtime/sandbox-name project) ":" guest-archive)))
            (fs/copy archive guest-archive {:replace-existing true}))
          (project-runtime/checked (project-runtime/run project "mkdir" "-p" (str (fs/path validation "source"))))
          (project-runtime/checked (project-runtime/run project "tar" "-xf" guest-archive "-C" (str (fs/path validation "source"))))
          (project-runtime/run project "rm" "-f" guest-archive)
          (let [result (project-runtime/run project "sh" "-c" "cd -- \"$1\" && exec sh -lc \"$2\""
                                            "swarmforge-validation" (str (fs/path validation "source"))
                                            (:validation-command cfg))]
            (spit (str (fs/path (project-runtime/host-dir project) "validation.log")) (str (:out result) (:err result)))
            (when-not (zero? (:exit result)) (fail! "Publication validation failed; see validation.log")))
          (save! project (update-batch (state project) (assoc b :validated-at (now))))))
      (let [s (state project) b (active-batch s)
            existing (pr-for cfg branch)]
        (when-not existing
          (host-git dir "push" "origin" (str (:published-sha b) ":refs/heads/" branch))
          (let [body (fs/path (project-runtime/host-dir project) "pr-body.md")]
            (spit (str body) (str "Completed approved batch " (:id b) ".\n\nIssues:\n"
                                  (apply str (for [[n issue] (sort-by key (:issues b))]
                                               (str "- #" n " — " (:title issue) "\n")))
                                  "\nCards:\n" (apply str (map #(str "- " (:name %) "\n") (:cards b)))
                                  "\nValidation: `" (:validation-command cfg) "` passed on `" (:published-sha b) "`.\n"
                                  "\nAll configured handoffs and quality gates completed. Human review and merge required.\n"))
            (gh "pr" "create" "--repo" (:repository cfg) "--draft" "--base" (:target b)
                "--head" branch "--title" (str "SwarmForge: " (:id b)) "--body-file" (str body))))
        (let [pr (or existing (pr-for cfg branch))]
          (when-not pr (fail! "PR response unavailable; retry will reconcile by branch"))
          (when-not (= (:published-sha b) (:headRefOid pr)) (fail! "Existing PR head differs from validated commit"))
          (save! project (update-batch s (assoc b :status :pr-open :pr pr))))))))

(defn tick! [project notify!]
  (locked project
    #(try
       (config! project)
       (poll! project)
       (let [s (state project)
             progress (hash (board project))
             millis (System/currentTimeMillis)
             s (if (not= progress (:progress s))
                 (save! project (assoc s :progress progress :progress-at millis)) s)]
         (when (seq (:pending-notify s))
           (notify! (select-keys (:issues s) (:pending-notify s)))
           (save! project (dissoc s :pending-notify)))
         ;; Reconcile a published PR even while another Attention item is open.
         ;; Otherwise an Issue closed at merge time can permanently freeze it.
         (let [b (active-batch (state project))]
           (when (= :pr-open (:status b))
             (let [pr (pr-for (config! project) (:branch b))]
               (cond
                 (:mergedAt pr) (save! project (update-batch (state project) (assoc b :status :merged :pr pr)))
                 (= "CLOSED" (:state pr)) (fail! "Draft PR was closed without merging; review the batch")))))
         (when-not (:error (state project))
           (let [b (active-batch (state project))]
             (when (and (= :running (:status b))
                        (> (- millis (or (:progress-at s) millis))
                           (* 1000 (:stall-seconds (project-runtime/config project) 1800))))
               (fail! "No card has advanced for the configured stall interval; inspect the agent panes and retry"))
             (when (and b (ready? project b)) (publish! project)))))
       (catch Exception e
         (save! project (assoc (state project) :error (.getMessage e)))))))
(defn retry! [project]
  (locked project #(save! project (assoc (dissoc (state project) :error) :progress-at (System/currentTimeMillis)))))

(when (= (str *file*) (System/getProperty "babashka.file"))
  (let [[command project input] *command-line-args*]
    (case command
      "status" (prn (state project))
      "propose" (prn (propose! project (edn/read-string (slurp input))))
      "configure" (let [cfg (edn/read-string (slurp input))]
                    (when-not (map? cfg) (fail! "Configuration must be an EDN map"))
                    (project-runtime/write-edn! (fs/path (project-runtime/host-dir project) "config.edn") cfg)
                    (when (:github-enabled cfg)
                      (config! project)
                      (save! project (state project)))
                    (println "Configured"))
      (fail! "Usage: bb github_flow.bb status PROJECT | propose PROJECT cards.edn | configure PROJECT config.edn"))))
