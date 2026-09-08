(ns test-swarm-forge.clamp-spec
  (:require [speclj.core :refer :all]
            [test-swarm-forge.clamp :as clamp]))

(describe "clamp"
  (it "returns the lower bound for values below it"
    (should= 0 (clamp/clamp -1 0 10)))

  (it "returns values inside the bounds unchanged"
    (should= 5 (clamp/clamp 5 0 10)))

  (it "returns the upper bound for values above it"
    (should= 10 (clamp/clamp 11 0 10)))

  (it "returns the equal bound when the bounds are equal"
    (should= 5 (clamp/clamp 3 5 5)))

  (it "rejects reversed bounds"
    (should-throw clojure.lang.ExceptionInfo
      (clamp/clamp 5 10 0))))
