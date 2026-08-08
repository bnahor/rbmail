# Rubidium for iPhone and iPad

This is the first native SwiftUI shell for the hosted Rubidium application. It
uses a persistent `WKWebView` session so the existing mail, calendar, search,
and Composio connection flows remain available while individual screens are
replaced with native SwiftUI over time.

The native layer includes semantic Core Haptics cues for navigation, mail
actions, success/error states, and a distinct on-device intelligence pattern.
On iOS 26 and supported Apple Intelligence devices, the native Intelligence
sheet uses Apple's Foundation Models framework to summarize the visible mail,
extract next steps, and draft a reply without sending mail content to a hosted
model. Liquid Glass is used on iOS 26 with material-based fallbacks on iOS 17–25.

## Run locally

1. Install the current release of Xcode from the Mac App Store.
2. Open `Rubidium.xcodeproj`.
3. In **Signing & Capabilities**, select your Apple Developer team and change
   `dev.bnahor.rubidium` if that bundle identifier is unavailable.
4. Select an iPhone simulator or connected device and press Run.

The app points at `https://rbmail-production.up.railway.app`. Change
`RBMailAppURL` in `Rubidium/Info.plist` for a staging deployment.

## TestFlight

After signing is configured, run `scripts/build-ios.sh`. The script creates an
App Store archive and exports/uploads it with Xcode's automatic signing. An app
record with the same bundle identifier must already exist in App Store Connect.

This shell is suitable for an internal pilot. Before a public App Store release,
move authentication and the core inbox/thread/calendar surfaces to native API
clients so the app delivers substantial native functionality and accessibility.
