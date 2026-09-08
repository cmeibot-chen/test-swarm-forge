(ns test-swarm-forge.average-spec
  (:require [speclj.core :refer :all]
            [test-swarm-forge.average :as average]))

(describe "average"
  (it "returns the only value for a one-value collection"
    (should= 7 (average/average [7])))

  (it "returns the arithmetic mean of multiple values"
    (should= 4 (average/average [2 4 6])))

  (it "preserves fractional results"
    (should= 3/2 (average/average [1 2])))

  (it "rejects an empty collection"
    (should-throw clojure.lang.ExceptionInfo
      (average/average []))))
