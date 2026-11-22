//
//  ViewController.swift
//  FocusBuffer
//
//  The app itself is only the onboarding page for the Safari extension:
//  Resources/Base.lproj/Main.html, shown in a web view.
//

import SafariServices
import UIKit
import WebKit

class ViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()

        self.webView.navigationDelegate = self
        self.webView.isOpaque = false
        self.webView.backgroundColor = .clear
        self.view.backgroundColor = UIColor(named: "Background") ?? .systemBackground

        self.webView.configuration.userContentController.add(self, name: "controller")

        self.webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.body as? String == "open-settings" else {
            return
        }
        // iOS 26.2 can open Settings right at this extension's page under
        // Safari > Extensions. The app's own Settings page (the only thing
        // older systems can open) has no link to Safari's extensions, so
        // it's only a fallback.
        if #available(iOS 26.2, *), let appID = Bundle.main.bundleIdentifier {
            SFSafariSettings.openExtensionsSettings(forIdentifiers: [appID + ".Extension"]) { error in
                if error != nil {
                    self.openAppSettings()
                }
            }
        } else {
            openAppSettings()
        }
    }

    private func openAppSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }

}
