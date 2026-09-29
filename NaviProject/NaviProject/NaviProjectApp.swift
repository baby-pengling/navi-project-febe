//
//  NaviProjectApp.swift
//  NaviProject
//
//  Created by 박서연 on 9/15/26.
//

import SwiftUI

@main
struct NaviProjectApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        #if os(macOS)
        .defaultSize(width: 1280, height: 720)
        .commands { AccountCommands() }
        #endif
    }
}
