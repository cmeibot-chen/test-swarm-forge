(ns test-swarm-forge.average)

(defn average [values]
  (when (empty? values)
    (throw (ex-info "Cannot calculate the average of an empty collection."
                    {:values values})))
  (/ (reduce + values) (count values)))
