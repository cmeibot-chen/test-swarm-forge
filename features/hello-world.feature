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
