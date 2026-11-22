//
//  ViewController.swift
//  FocusBuffer
//
//  The app itself is only the onboarding page for the Safari extension:
//  Resources/Base.lproj/Main.html, shown in a web view.
//

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
        // iOS has no public link straight to Safari's extension list; this
        // opens the app's own page in Settings, one step away from it.
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }

}
