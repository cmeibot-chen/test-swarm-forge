#!/usr/bin/env bb

(ns swarm-tool
  (:require [babashka.fs :as fs]
            [clojure.java.io :as io]
            [clojure.java.shell :as sh]
            [clojure.string :as str])
  (:import [java.nio.channels FileChannel]
           [java.nio.file Files StandardOpenOption]
           [java.security MessageDigest]))

(def catalog
  {"gherkin-parser" {:source "github.com/unclebob/Acceptance-Pipeline-Specification"
                     :revision "accaa33d503340c56513ef387258f8da929ba902"
                     :bb-task "gherkin-parser"}
   "ir-dry-checker" {:source "github.com/unclebob/Acceptance-Pipeline-Specification"
                     :revision "accaa33d503340c56513ef387258f8da929ba902"
                     :bb-task "gherkin-ir-dry-checker"}
   "gherkin-mutator" {:source "github.com/unclebob/Acceptance-Pipeline-Specification"
                      :revision "accaa33d503340c56513ef387258f8da929ba902"
                      :bb-task "gherkin-mutator"}
   "crap4clj" {:source "github.com/unclebob/crap4clj" :bb-task "crap4clj"
               :needs ["cloverage"]}
   "dry4clj" {:source "github.com/unclebob/dry4clj" :bb-task "dry4clj"}
   "clj-mutate" {:source "github.com/unclebob/clj-mutate" :bb-task "clj-mutate"
                 :needs ["cloverage"]}
   "cloverage" {:mvn "cloverage/cloverage" :main "cloverage.coverage"
                :paths ["src" "spec" "test"]
                :extra-deps {"speclj/speclj" "3.13.0"}
                :args ["-p" "src" "-s" "spec" "-s" "test" "-r" "speclj"]}
   "speclj" {:mvn "speclj/speclj" :main "speclj.main" :version "3.13.0"
             :paths ["src" "spec" "test"]
             :args ["-c" "spec"]}
   "speclj-structure-check" {:source "github.com/unclebob/speclj-structure-check"
                             :bb-task "check"}
   "crap4go" {:source "github.com/unclebob/crap4go" :bb-task "crap4go"}
   "dry4go" {:source "github.com/unclebob/dry4go" :bb-task "dry4go"}
   "mutate4go" {:source "github.com/unclebob/mutate4go" :bb-task "mutate4go"}
   "crap4java" {:source "github.com/unclebob/crap4java" :bb-task "crap4java"}
   "dry4java" {:source "github.com/unclebob/dry4java" :bb-task "dry4java"}
   "mutate4java" {:source "github.com/unclebob/mutate4java" :bb-task "mutate4java"}
   "stryker" {:npm-package "@stryker-mutator/core" :bin "stryker"}
   "jscpd" {:npm-package "jscpd" :bin "jscpd"}
   "crap-typescript" {:npm-package "@barney-media/crap-typescript" :bin "crap-typescript"}
   "typescript" {:npm-package "typescript" :bin "tsc"}
   "eslint" {:npm-package "eslint" :bin "eslint"}
   "vitest" {:npm-package "vitest" :bin "vitest"}
   "playwright" {:npm-package "@playwright/test" :bin "playwright"}})

(def usage-text
  (str "Usage:\n"
       "  swarm_tool.sh require <tool>\n"
       "  swarm_tool.sh ensure <tool>\n\n"
       "Tools: " (str/join ", " (sort (keys catalog)))))

(defn usage []
  (binding [*out* *err*]
    (println usage-text)))

(defn exit! [status message]
  (binding [*out* *err*]
    (when message
      (println message)))
  (System/exit status))

(defn sq [value]
  (str "'" (str/replace (str value) #"'" "'\"'\"'") "'"))

(defn roles-at? [root]
  (and root (fs/exists? (fs/path root ".swarmforge" "roles.tsv"))))

(defn npm-root? [root]
  (and root (fs/regular-file? (fs/path root "package.json"))))

(defn npm-project? [root]
  (and (npm-root? root)
       (fs/regular-file? (fs/path root "package-lock.json"))))

(defn ancestor-paths [start]
  (loop [root (fs/absolutize start) paths []]
    (if root
      (recur (fs/parent root) (conj paths root))
      paths)))

(defn explicit-project-root []
  (when-let [value (not-empty (System/getenv "SWARMFORGE_PROJECT_ROOT"))]
    (let [root (fs/canonicalize value)]
      (when-not (or (npm-root? root) (roles-at? root))
        (exit! 1 (str "SWARMFORGE_PROJECT_ROOT is not a SwarmForge project: " root)))
      (str root))))

(defn nearest-project-root []
  (some (fn [root]
          (when (or (npm-root? root) (roles-at? root))
            (str root)))
        (ancestor-paths (fs/cwd))))

(defn nearest-npm-project []
  (some (fn [root] (when (npm-project? root) root))
        (ancestor-paths (fs/cwd))))

(declare tool-spec)

(defn project-root [tool]
  (or (explicit-project-root)
      (nearest-project-root)
      (exit! 1 (str "Cannot find SwarmForge project root for " tool
                    ". Run from the project or set SWARMFORGE_PROJECT_ROOT."))))

(defn absolute-symlink? [path]
  (and (fs/sym-link? path)
       (fs/absolute? (Files/readSymbolicLink (fs/path path)))))

(defn safe-executable? [path]
  (and (fs/executable? path) (not (absolute-symlink? path))))

(defn sha256-file [path]
  (let [digest (MessageDigest/getInstance "SHA-256")]
    (with-open [input (io/input-stream (str path))]
      (let [buffer (byte-array 8192)]
        (loop []
          (let [read (.read input buffer)]
            (when (pos? read)
              (.update digest buffer 0 read)
              (recur))))))
    (apply str (map #(format "%02x" (bit-and (int %) 0xff)) (.digest digest)))))

(defn with-file-lock [path f]
  (fs/create-dirs (fs/parent path))
  (with-open [channel (FileChannel/open (fs/path path)
                                        (into-array StandardOpenOption
                                                    [StandardOpenOption/CREATE
                                                     StandardOpenOption/WRITE]))]
    (with-open [_lock (.lock channel)]
      (f))))

(defn npm-state-file [root]
  (fs/path root ".swarmforge" "tooling" "npm-lock.sha256"))

(defn npm-ready? [root lock-hash]
  (and (fs/regular-file? (fs/path root "node_modules" ".package-lock.json"))
       (= lock-hash (str/trim (if (fs/regular-file? (npm-state-file root))
                                (slurp (str (npm-state-file root)))
                                "")))))

(def npm-prepared (atom #{}))

(defn ensure-npm-deps! [root]
  (when-not (fs/regular-file? (fs/path root "package.json"))
    (exit! 1 (str "TypeScript tools require package.json in " root)))
  (when-not (fs/regular-file? (fs/path root "package-lock.json"))
    (exit! 1 (str "TypeScript tools require package-lock.json in " root
                  "; run npm install once to create it")))
  (let [key (str (fs/canonicalize root))]
    (when-not (contains? @npm-prepared key)
      (with-file-lock (fs/path root ".swarmforge" "tooling" "npm-ci.lock")
        (fn []
          (let [lock-hash (sha256-file (fs/path root "package-lock.json"))]
            (when-not (npm-ready? root lock-hash)
              (let [result (sh/sh "npm" "ci" "--ignore-scripts" :dir (str root))]
                (when-not (zero? (:exit result))
                  (exit! 1 (str "npm ci --ignore-scripts failed in " root "\n"
                                (:err result) (:out result)))))
              (spit (str (npm-state-file root)) (str lock-hash "\n")))
            (when-not (npm-ready? root lock-hash)
              (exit! 1 (str "npm dependencies were not prepared in " root))))))
      (swap! npm-prepared conj key))))

(defn canonical-tool [tool]
  (str/lower-case (or tool "")))

(defn tool-spec [tool]
  (or (get catalog (canonical-tool tool))
      (exit! 1 (str "Unknown tool: " tool "\n\n" usage-text))))

(defn bin-dir [root]
  (fs/path root ".swarmforge" "bin"))

(defn wrapper-path [root tool]
  (fs/path (bin-dir root) (canonical-tool tool)))

(defn npm-bin-path [root spec]
  (fs/path root "node_modules" ".bin" (:bin spec)))

(defn source-dir [root source]
  (if-let [override (not-empty (System/getenv "SWARMFORGE_TOOL_SRC"))]
    (fs/path override)
    (fs/path root ".swarmforge" "tools" (last (str/split source #"/")))))

(defn needed-tools [tool]
  (vec (or (:needs (tool-spec tool)) [])))

(defn missing-tool [root tool]
  (first (remove #(and (safe-executable? (wrapper-path root %))
                       (let [spec (tool-spec %)]
                         (or (not (:npm-package spec))
                             (safe-executable? (npm-bin-path root spec)))))
                (cons tool (needed-tools tool)))))

(defn require-tool! [tool]
  (tool-spec tool)
  (let [root (project-root tool)
        missing (missing-tool root tool)]
    (if missing
      (exit! 1 (str "MISSING: " missing "\nRun: swarm_tool.sh ensure " missing))
      (do (println "OK:" tool (str (wrapper-path root tool)))
          (System/exit 0)))))

(defn clone-source! [dir source]
  (fs/create-dirs (fs/parent dir))
  (let [url (str "https://" source ".git")
        result (sh/sh "git" "clone" "--depth" "1" url (str dir))]
    (when-not (zero? (:exit result))
      (exit! 1 (str "Failed to clone " url "\n" (:err result) (:out result))))))

(defn source-head [dir]
  (let [result (sh/sh "git" "-C" (str dir) "rev-parse" "HEAD")]
    (when (zero? (:exit result)) (str/trim (:out result)))))

(defn ensure-pinned-source! [dir spec]
  (when-let [revision (:revision spec)]
    (when-not (fs/exists? (fs/path dir ".git"))
      (exit! 1 (str "Pinned tool source is not a Git checkout: " dir)))
    (when-not (= revision (source-head dir))
      (let [fetch (sh/sh "git" "-C" (str dir) "fetch" "--depth" "1" "origin" revision)]
        (when-not (zero? (:exit fetch))
          (exit! 1 (str "Failed to fetch pinned tool revision " revision "\n"
                        (:err fetch) (:out fetch)))))
      (let [checkout (sh/sh "git" "-C" (str dir) "checkout" "--detach" revision)]
        (when-not (zero? (:exit checkout))
          (exit! 1 (str "Failed to checkout pinned tool revision " revision "\n"
                        (:err checkout) (:out checkout))))))
    (when-not (= revision (source-head dir))
      (exit! 1 (str "Tool source revision mismatch in " dir
                    ": expected " revision)))))

(defn ensure-source! [root spec]
  (let [source (:source spec)
        dir (source-dir root source)
        override (not-empty (System/getenv "SWARMFORGE_TOOL_SRC"))]
    (when-not (fs/exists? (fs/path dir "bb.edn"))
      (when override
        (exit! 1 (str "SWARMFORGE_TOOL_SRC is missing bb.edn: " dir)))
      (clone-source! dir source))
    (when-not override
      (ensure-pinned-source! dir spec))
    dir))

(defn mutate-rewrite-bash []
  (str "args=()\n"
       "scan=\n"
       "while [ $# -gt 0 ]; do\n"
       "  case \"$1\" in\n"
       "    --mutate-all) shift ;;\n"
       "    --scan|--update-manifest) scan=1; args+=(\"$1\"); shift ;;\n"
       "    --max-workers) shift; [ $# -gt 0 ] && shift ;;\n"
       "    *) args+=(\"$1\"); shift ;;\n"
       "  esac\n"
       "done\n"
       "if [ -z \"$scan\" ]; then args+=(--max-workers 4); fi\n"
       "set -- \"${args[@]}\"\n"))

(defn gherkin-rewrite-bash []
  (str "args=()\n"
       "while [ $# -gt 0 ]; do\n"
       "  case \"$1\" in\n"
       "    --level)\n"
       "      if [ \"${2:-}\" = full ]; then args+=(--level hard); else args+=(\"$1\" \"$2\"); fi\n"
       "      shift; [ $# -gt 0 ] && shift ;;\n"
       "    --workers) shift; [ $# -gt 0 ] && shift ;;\n"
       "    *) args+=(\"$1\"); shift ;;\n"
       "  esac\n"
       "done\n"
       "args+=(--workers 4)\n"
       "set -- \"${args[@]}\"\n"))

(defn rewrite-bash [tool]
  (cond
    (#{"clj-mutate" "mutate4go" "mutate4java"} tool) (mutate-rewrite-bash)
    (= "gherkin-mutator" tool) (gherkin-rewrite-bash)
    :else ""))

(defn write-wrapper! [path body]
  (when (absolute-symlink? path)
    (fs/delete-if-exists path))
  (fs/create-dirs (fs/parent path))
  (spit (str path) (str "#!/usr/bin/env bash\n" body))
  (fs/set-posix-file-permissions path "rwxr-xr-x")
  path)

(defn write-bb-wrapper! [root tool bb-task src-dir]
  (let [target (wrapper-path root tool)
        config (str (fs/path src-dir "bb.edn"))]
    (write-wrapper!
     target
     (str (rewrite-bash tool)
          "exec bb --config " (sq config) " " bb-task " \"$@\"\n"))))

(defn write-npm-wrapper! [root tool spec]
  (let [target (wrapper-path root tool)
        binary (npm-bin-path root spec)]
    (write-wrapper! target (str "exec " (sq (str binary)) " \"$@\"\n"))))

(defn edn-paths [paths]
  (str/join " " (map pr-str (or paths []))))

(defn coord-dep [coord version]
  (str coord " {:mvn/version " (pr-str version) "}"))

(defn edn-deps [spec]
  (let [main (coord-dep (:mvn spec) (or (:version spec) "RELEASE"))
        extra (map (fn [[coord version]] (coord-dep coord version))
                   (or (:extra-deps spec) {}))]
    (str/join " " (cons main extra))))

(defn write-mvn-wrapper! [root tool spec]
  (let [target (wrapper-path root tool)
        deps (str "{:paths [" (edn-paths (:paths spec)) "] :deps {" (edn-deps spec) "}}")
        args (str/join " " (or (:args spec) []))]
    (write-wrapper!
     target
     (str (rewrite-bash tool)
          "exec clojure -Sdeps " (sq deps) " -M -m " (:main spec)
          (when (seq args) (str " " args))
          " \"$@\"\n"))))

(defn install-one! [tool]
  (let [spec (tool-spec tool)
        root (project-root tool)
        name (canonical-tool tool)
        target (cond
                 (:npm-package spec) (do
                                       (ensure-npm-deps! root)
                                       (when-not (safe-executable? (npm-bin-path root spec))
                                         (exit! 1 (str "Locked npm package is missing its executable: "
                                                       (:npm-package spec))))
                                       (write-npm-wrapper! root name spec))
                 (:bb-task spec) (write-bb-wrapper! root name (:bb-task spec)
                                                     (ensure-source! root spec))
                 :else (write-mvn-wrapper! root name spec))]
    (println "INSTALLED:" name (str target))))

(defn ensure-tool! [tool]
  (tool-spec tool)
  (doseq [dep (needed-tools tool)]
    (ensure-tool! dep))
  (install-one! tool))

(defn -main [& args]
  (when (some #{"--help" "-h"} args)
    (usage)
    (System/exit 0))
  (when (not= 2 (count args))
    (usage)
    (System/exit 1))
  (let [[command tool] args]
    (case command
      "require" (require-tool! tool)
      "ensure" (ensure-tool! tool)
      (do (usage)
          (System/exit 1)))))

(when (= (str *file*) (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
