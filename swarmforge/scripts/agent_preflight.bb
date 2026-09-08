(ns agent-preflight
  (:require [babashka.process :as process]
            [clojure.java.io :as io]
            [clojure.string :as str]
            [cheshire.core :as json]))

(defn fail! [message] (throw (ex-info message {})))
(defn output! [args]
  (let [p (process/process args {:out :string :err :string})
        result (deref (future @p) 60000 ::timeout)]
    (when (= result ::timeout) (process/destroy-tree p) (fail! "Agent check timed out; check login"))
    (when-not (zero? (:exit result)) (fail! (str "Agent check failed: " (:err result))))
    (:out result)))

(defn codex-models []
  (output! ["codex" "login" "status"])
  (let [p (process/process ["codex" "app-server"] {:in :stream :out :stream :err :string})]
    (try
      (with-open [writer (io/writer (:in p)) reader (io/reader (:out p))]
        (let [send! (fn [message] (.write writer (str (json/generate-string message) "\n")) (.flush writer))
              read-id (fn [id]
                        (let [reply (deref (future
                                             (loop []
                                               (when-let [line (.readLine reader)]
                                                 (let [m (json/parse-string line true)]
                                                   (if (= id (:id m)) m (recur)))))) 30000 ::timeout)]
                          (when (or (= reply ::timeout) (nil? reply) (:error reply))
                            (process/destroy-tree p)
                            (fail! "Could not query the authenticated Codex model catalog"))
                          (:result reply)))]
          (send! {:id 1 :method "initialize" :params {:clientInfo {:name "swarmforge" :version "1"}}})
          (read-id 1)
          (send! {:method "initialized" :params {}})
          (loop [cursor nil models [] id 2]
            (send! {:id id :method "model/list" :params {:cursor cursor :limit 100 :includeHidden true}})
            (let [result (read-id id) models (into models (:data result))]
              (if-let [next (:nextCursor result)] (recur next models (inc id)) models)))))
      (finally (process/destroy-tree p)))))

(defn requested [row]
  (let [args (or (:extra-args row) "")]
    {:agent (:agent row)
     :model (second (re-find #"(?:--model|-m)\s+([A-Za-z0-9._-]+)" args))
     :effort (second (re-find #"model_reasoning_effort=[\\\"']*([A-Za-z]+)" args))}))
(defn verify-model! [models {:keys [model effort]}]
  (let [entry (some #(when (= model (or (:model %) (:id %))) %) models)]
    (when-not entry (fail! (str "Requested Codex model unavailable: " model)))
    (when-not (some #(= effort (:reasoningEffort %)) (:supportedReasoningEfforts entry))
      (fail! (str "Requested reasoning effort unavailable: " model " / " effort)))))
(defn check! [rows]
  (let [requests (distinct (keep #(let [r (requested %)] (when (:model r) r)) rows))
        codex (filter #(= "codex" (:agent %)) requests)
        agy (filter #(= "agy" (:agent %)) requests)]
    (when (seq codex)
      (let [models (codex-models)] (doseq [r codex] (verify-model! models r))))
    (doseq [{:keys [model]} agy]
      (let [models (output! ["agy" "models"])]
        (when-not (some #{model} (str/split models #"\s+"))
          (fail! (str "Requested Antigravity model unavailable: " model))))
      ;; Model listing alone does not establish subscription authentication.
      (let [response (json/parse-string
                      (output! ["agy" "-p" "Reply OK without using tools."
                                "--model" model "--output-format" "json" "--print-timeout" "30s"]) true)]
        (when-not (= "SUCCESS" (:status response))
          (fail! "Antigravity login/model check did not complete successfully"))))))
