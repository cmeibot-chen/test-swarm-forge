(ns test-swarm-forge.core-spec
  (:require [speclj.core :refer :all]
            [test-swarm-forge.core :as core]))

(describe "core"
  (it "responds to ping"
    (should= :pong (core/ping))))
