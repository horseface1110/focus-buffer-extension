# Focus Buffer — iPhone Safari edition

This folder contains the Safari Web Extension port of the existing Chrome extension. The Chrome implementation at the repository root is intentionally unchanged.

## Feature parity

- Default targets: Instagram, Facebook, and YouTube.
- Add/remove domains or full HTTP(S) URL paths.
- Add the current Safari website to the list.
- Show the existing full-page pause overlay on matching pages.
- Show today's usage for the current target and all targets.
- Require a 10-second wait before continuing.
- Close the current Safari tab after the configured amount of foreground use (default: 5 minutes).
- Keep settings and usage data locally on the device. No server, account, analytics, or remote API is used.

## Platform requirements

The extension uses Safari's dynamic content-script registration and optional host-permission flow. The manifest targets Safari 27 / iOS 27 so the same behavior can be tested against the current Safari Web Extension permission model.

The extension only affects Safari. It does not block the same sites in Chrome, other browsers, or native apps.

## Generate the Xcode project

Install Xcode and clone this repository on your Mac. From the repository root, run:

    xcrun safari-web-extension-packager ./ios/extension \
      --project-location ./ios/FocusBufferXcode \
      --app-name FocusBuffer \
      --bundle-identifier com.horseface1110.focusbuffer \
      --swift \
      --ios-only \
      --copy-resources \
      --no-open

Then open:

    open ./ios/FocusBufferXcode/FocusBuffer.xcodeproj

The packager creates the iOS containing app and Safari Web Extension targets. The project is generated locally and is not committed because it contains machine-specific signing and Xcode project configuration.

## Build and install on iPhone

1. Open the generated project in Xcode.
2. Select the containing iOS app target and set your own development Team under Signing & Capabilities.
3. Connect your iPhone, select it as the run destination, and choose Product > Run.
4. On iPhone, open Settings > Apps > Safari > Extensions (the exact Settings grouping can vary by iOS release).
5. Enable Focus Buffer.
6. Open Safari > More > Extensions > Focus Buffer.
7. Tap **Grant access to listed websites**. Safari asks for access to the sites in the current list.
8. Visit one of the listed sites. The pause overlay should appear.

Apple documents that running the containing app installs the extension, and that the extension must then be enabled in Safari. Physical-device testing requires Apple Developer Program membership; the iOS Simulator can be used before enrolling.

## Permission model

Safari requires explicit host access before a content script can run on a site. The extension therefore:

- requests only the domains the user adds;
- asks for permission from a user-initiated action;
- registers content scripts only for hosts whose permissions are granted;
- removes a host permission when the last matching target is removed.

A URL target such as https://example.com/path requests access to that host, but the overlay itself only appears on URLs whose path starts with /path. A domain target such as reddit.com matches the domain and its subdomains.

## Timer behavior

The auto-close timer counts foreground time on the page after the user chooses to continue. It pauses when Safari hides the page, matching the Chrome version's visibilityState behavior. The per-visit elapsed time is kept in sessionStorage so reloading the same page does not reset the configured auto-close timer.

Today's usage is accumulated in browser.storage.local and is scoped to the device's local calendar day.

## Development notes

- Edit the files in ios/extension/.
- Re-run the packager only if you need to regenerate the Xcode project structure.
- After changing extension resources, build and run the iOS app target again in Xcode to copy the updated resources into the installed app.
- To debug the extension, connect the iPhone to the Mac, enable Web Inspector on iPhone, then use Safari on Mac > Develop > [your iPhone] > Focus Buffer extension page.

The extension has not yet been built or run on a physical iPhone from this environment. Complete the device test checklist above before treating the port as release-ready.
