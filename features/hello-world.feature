# mutation-stamp: sha256=247dbac422ca10e28eb6fd3af942d6b33c6a8c5c85ce7e33bc43ef9bcbba3977
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-09T10:22:41.897379964Z","feature_name":"Hello World","feature_path":"features/hello-world.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"sha256:a8571ca85cb8b1bfa51b1a93dd66158339cd78acb99f7c27647d66510fb6a93e","scenarios":[{"index":0,"name":"Hello World 01 - root page presents the greeting","scenario_hash":"3663ee5e709657da9d67dc7d82fa8fbb52e6b3024e1c6b228efa7b8467bdacf2","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-09T10:18:58.907967805Z"}]}
# acceptance-mutation-manifest-end

# Hello World 01 - root page presents the greeting
Feature: Hello World

  Scenario Outline: Hello World 01 - root page presents the greeting
    Given the application is running
    When I open the root page
    Then the page has one visible level-one heading with exact text <greeting>
    And the document title is <title>
    And the page has a main landmark
    And no todo entry form or todo list is displayed

    Examples:
      | greeting    | title       |
      | Hello World | Hello World |
