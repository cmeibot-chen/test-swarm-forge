(ns test-swarm-forge.clamp)

(defn clamp [value lower upper]
  (when (> lower upper)
    (throw (ex-info "Lower bound must not exceed upper bound."
                    {:lower lower
                     :upper upper})))
  (max lower (min upper value)))
