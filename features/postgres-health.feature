# PostgreSQL health 01 - health reflects database availability
Feature: PostgreSQL health

  Background:
    Given the application is running

  Scenario Outline: PostgreSQL health 01 - health reflects database availability
    Given PostgreSQL is <availability>
    When I request the health path
    Then the HTTP response code is <code>
    And the JSON response has status <status>

    Examples:
      | availability | code | status      |
      | reachable    | 200  | ok          |
      | unreachable  | 503  | unavailable |
