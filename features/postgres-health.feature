# PostgreSQL health 01 - health reflects database availability
Feature: PostgreSQL health

  Background:
    Given the application is running

  Scenario Outline: PostgreSQL health 01 - health reflects database availability
    Given PostgreSQL is <availability>
    When I send GET to /api/health
    Then the HTTP response code is <code>
    And the JSON response has status <status>

    Examples:
      | availability | code | status      |
      | reachable    | 200  | ok          |
      | unreachable  | 503  | unavailable |
