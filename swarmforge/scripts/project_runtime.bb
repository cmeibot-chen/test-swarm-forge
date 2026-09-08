(ns project-runtime
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.java.shell :as shell]
            [clojure.edn :as edn]
            [clojure.string :as str]
            [cheshire.core :as json]))

(defn inside? [] (= "1" (System/getenv "SWARMFORGE_IN_SANDBOX")))
(defn read-edn [file default]
  (if (fs/regular-file? file) (edn/read-string (slurp (str file))) default))
(defn write-edn! [file value]
  (fs/create-dirs (fs/parent file))
  (let [tmp (fs/create-temp-file {:dir (fs/parent file) :prefix ".state-"})]
    (spit (str tmp) (str (pr-str value) "\n"))
    (fs/move tmp file {:atomic-move true :replace-existing true})))

(def project-name-pattern #"[A-Za-z0-9][A-Za-z0-9._-]*")

(defn canonical-path [path]
  (try
    (fs/canonicalize path)
    (catch Exception _
      (fs/absolutize path))))

(defn forge-root [project]
  (let [project (canonical-path project)
        projects (fs/parent project)
        forge (some-> projects fs/parent)
        name (some-> project fs/file-name)]
    (when (and (fs/directory? project)
               projects
               (= "projects" (fs/file-name projects))
               forge
               (fs/directory? forge)
               (re-matches project-name-pattern (str name)))
      forge)))

(defn host-dir [project]
  (let [project (canonical-path project)]
    (when-let [forge (forge-root project)]
      (when-not (re-matches project-name-pattern (str (fs/file-name project)))
        (throw (ex-info (str "Invalid project name: " project) {})))
      (fs/path forge ".swarmforge" "integrations" (fs/file-name project)))))
(defn config [project]
  (if-let [forge (forge-root project)]
    (merge {:runtime :local :poll-seconds 60 :issue-label "swarmforge"}
           (read-edn (fs/path forge "swarmforge" "runtime-defaults.edn") {})
           (read-edn (fs/path (host-dir project) "config.edn") {}))
    {:runtime :local}))
(defn sandboxed? [project]
  (and (not (inside?)) (= :sbx (:runtime (config project)))))
(defn sandbox-name [project]
  (let [project (canonical-path project)
        name (str (fs/file-name project))]
    (str "swarmforge-" (subs (str/replace name #"[^A-Za-z0-9.-]" "-")
                              0 (min 35 (count name)))
         "-" (format "%08x" (bit-and 0xffffffff (hash (str project)))))))

(defn exec-argv [project argv]
  (if (sandboxed? project)
    (into ["sbx" "exec" "-e" "SWARMFORGE_IN_SANDBOX=1"
           "-e" "SWARMFORGE_TERMINAL_BACKEND=none"
           "-e" "SWARMFORGE_PREVENT_SLEEP=0" "-w" (str project)
           (sandbox-name project)]
          (mapv (fn [arg]
                  (if-let [forge (forge-root project)]
                    (let [raw-forge (fs/parent (fs/parent (fs/absolutize project)))
                          prefixes [(str forge "/swarmforge/scripts/")
                                    (str raw-forge "/swarmforge/scripts/")]
                          prefix (some #(when (and (string? arg)
                                                   (str/starts-with? arg %)) %)
                                       (distinct prefixes))]
                      (if prefix
                        (str project "/swarmforge/scripts/" (subs arg (count prefix))) arg))
                    arg)) argv))
    (vec argv)))
(defn run [project & argv]
  (apply shell/sh (exec-argv project argv)))
(defn checked [result]
  (when-not (zero? (:exit result))
    (throw (ex-info (str/trim (str (:err result) "\n" (:out result)))
                    {:exit (:exit result)})))
  (:out result))
(def ^:dynamic *sandbox-states* nil)
(defn read-sandbox-state [project]
  (let [entries (json/parse-string (checked (shell/sh "sbx" "ls" "--json")) true)]
    (some #(when (= (sandbox-name project) (or (:name %) (:Name %))) %)
          (if (vector? entries)
            entries
            (or (:sandboxes entries) (:items entries) (:data entries) [])))))
(defn sandbox-state [project]
  (if *sandbox-states*
    (let [k (str project)]
      (if (contains? @*sandbox-states* k) (get @*sandbox-states* k)
          (let [entry (read-sandbox-state project)]
            (swap! *sandbox-states* assoc k entry) entry)))
    (read-sandbox-state project)))
(defn running? [entry]
  (= "running" (str/lower-case (str (or (:status entry) (:state entry) (:Status entry) (:State entry))))))
(defn stopped? [entry]
  (and (map? entry)
       (= "stopped" (str/lower-case
                     (str (or (:status entry) (:state entry) (:Status entry) (:State entry)))))))

(defn ensure! [project]
  (when (sandboxed? project)
    (let [{:keys [template cpus memory]} (config project)]
      (when (str/blank? template) (throw (ex-info "Sandbox template is required" {})))
      (let [name (sandbox-name project)
            state (sandbox-state project)]
        (cond
          (nil? state)
          (checked (shell/sh "sbx" "create" "--name" name
                             "--template" template "--cpus" (str (or cpus 4))
                             "--memory" (or memory "8g") "shell" (str project)))

          (stopped? state)
          (checked (shell/sh "sbx" "start" name))

          :else nil)))))

;; Socket names are VM-local. Register only through a known project root;
;; never infer a host process from a sandbox PID or socket pathname.
(defonce sockets (atom {}))
(defn register-socket! [project socket]
  (when (and socket (sandboxed? project)) (swap! sockets assoc socket (str project)))
  socket)
(defn argv-project [argv]
  (or (when (= "tmux" (first argv)) (get @sockets (nth argv 2 nil)))
      (some (fn [arg]
              (when (and (string? arg) (str/starts-with? arg "/"))
                (loop [p (fs/path arg)]
                  (when p
                    (if (forge-root p) (str p) (recur (fs/parent p))))))) argv)))
(defn sh [& argv]
  (if-let [project (and (not (inside?)) (argv-project argv))]
    (if (sandboxed? project)
      (let [[args opts] (split-with (complement keyword?) argv)]
        (if (and (= "tmux" (first args)) (not (running? (sandbox-state project))))
          {:exit 1 :out "" :err "Sandbox is not running"}
          (apply shell/sh (concat (exec-argv project args) opts))))
      (apply shell/sh argv))
    (apply shell/sh argv)))

(defn bb-command [project]
  (if (inside?)
    "bb"
    (let [launcher (fs/path project "swarmforge/scripts/bb.sh")]
      (cond
        (fs/executable? launcher) (str launcher)
        (not (str/blank? (System/getenv "SWARMFORGE_BB_PATH")))
        (System/getenv "SWARMFORGE_BB_PATH")
        :else "bb"))))

(defn runtime-check [project mode]
  (let [script (str (fs/path project "swarmforge/scripts/project_runtime.bb"))]
    (zero? (:exit (run project (bb-command project) script mode (str project))))))
(defn local-alive? [project]
  (let [state (fs/path project ".swarmforge")
        read-text #(when (fs/regular-file? %) (str/trim (slurp (str %))))
        socket (read-text (fs/path state "tmux-socket"))
        pid (read-text (fs/path state "daemon/handoffd.pid"))
        sessions (some-> (read-text (fs/path state "sessions.tsv")) str/split-lines)]
    (and (seq sessions) socket pid (re-matches #"[1-9][0-9]*" pid)
         (zero? (:exit (shell/sh "kill" "-0" pid)))
         (every? #(zero? (:exit (shell/sh "tmux" "-S" socket "has-session" "-t"
                                         (str "=" (nth (str/split % #"\t") 2))))) sessions))))
(defn local-stopped? [project]
  (let [state (fs/path project ".swarmforge")
        text #(when (fs/regular-file? %) (str/trim (slurp (str %))))
        socket (text (fs/path state "tmux-socket"))
        pid (text (fs/path state "daemon/handoffd.pid"))
        sessions (some-> (text (fs/path state "sessions.tsv")) str/split-lines)]
    (and (not (and pid (re-matches #"[1-9][0-9]*" pid)
                   (zero? (:exit (shell/sh "kill" "-0" pid)))))
         (not-any? #(and socket (zero? (:exit (shell/sh "tmux" "-S" socket "has-session"
                                                       "-t" (str "=" (nth (str/split % #"\t") 2)))))) sessions))))

(when (= (str *file*) (System/getProperty "babashka.file"))
  (let [[mode project] *command-line-args*]
    (System/exit (if ((case mode "ready" local-alive? "stopped" local-stopped?) project) 0 1))))
