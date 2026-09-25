//
//  NaviProjectUITests.swift
//  NaviProjectUITests
//
//  Created by 박서연 on 9/15/26.
//

import XCTest

final class NaviProjectUITests: XCTestCase {

    override func setUpWithError() throws {
        // Put setup code here. This method is called before the invocation of each test method in the class.

        // In UI tests it is usually best to stop immediately when a failure occurs.
        continueAfterFailure = false

        // In UI tests it’s important to set the initial state - such as interface orientation - required for your tests before they run. The setUp method is a good place to do this.
    }

    override func tearDownWithError() throws {
        // Put teardown code here. This method is called after the invocation of each test method in the class.
    }

    @MainActor
    func testExample() throws {
        let app = XCUIApplication()
        app.launch()

        XCTAssertTrue(app.buttons["navi.button.로그인"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["navi.button.새 계정 만들기"].exists)
    }

    @MainActor
    func testSignupRejectsMalformedEmailBeforeNetworkRequest() throws {
        let app = XCUIApplication()
        app.launch()

        let signUpButton = app.buttons["navi.button.새 계정 만들기"]
        XCTAssertTrue(signUpButton.waitForExistence(timeout: 5))
        signUpButton.click()

        let nameField = app.textFields["navi.input.이름"]
        let emailField = app.textFields["navi.input.이메일"]
        let passwordField = app.secureTextFields["navi.input.비밀번호"]
        XCTAssertTrue(nameField.waitForExistence(timeout: 3))
        XCTAssertTrue(emailField.exists)
        XCTAssertTrue(passwordField.exists)

        nameField.click()
        nameField.typeText("Navi UI Test")
        emailField.click()
        emailField.typeText("invalid-email")
        passwordField.click()
        passwordField.typeText("NaviE2E!20260924")
        app.buttons["navi.button.계정 만들기"].click()

        XCTAssertTrue(app.staticTexts["올바른 이메일이 아닙니다."].waitForExistence(timeout: 3))
    }

    @MainActor
    func testLaunchPerformance() throws {
        // This measures how long it takes to launch your application.
        measure(metrics: [XCTApplicationLaunchMetric()]) {
            XCUIApplication().launch()
        }
    }
}
