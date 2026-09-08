(ns test-swarm-forge.average)

(defn average
  "Returns the arithmetic mean of a nonempty numeric collection values.
   Throws ex-info when values is empty."
  [values]
  (when (empty? values)
    (throw (ex-info "Cannot calculate the average of an empty collection."
                    {:values values})))
  (/ (reduce + values) (count values)))
