# Earthquake Network Android System -- Technical APK Analysis

## 1. Scope and methodology

This document describes the internal architecture and network behavior of the Earthquake Network
Android application. It is based on static analysis of the distributed APK, not on assumptions made
from the user interface.

| Property         | Value                                                              |
| ---------------- | ------------------------------------------------------------------ |
| Application      | Earthquake Network                                                 |
| Android package  | `com.finazzi.distquake`                                            |
| Version name     | `26.7.23`                                                          |
| Version code     | `856`                                                              |
| Minimum SDK      | API 29                                                             |
| Target SDK       | API 37                                                             |
| XAPK SHA-256     | `ac82361cb84f97a74dd53a5e43f004c130c845ab8ff9fc17117b17053345dfa8` |
| Base APK SHA-256 | `46667c799b5a4a698e4d18ba8495125602840f92c61b4bfdfe545348151a2bd2` |
| Analysis date    | 2026-07-28                                                         |
| Decompiler       | JADX 1.5.6                                                         |

The XAPK was extracted and its base APK was decompiled. The analysis cross-references:

- `AndroidManifest.xml`;
- generated Android resources;
- preserved application class names;
- R8-obfuscated callback and HTTP helper classes;
- endpoint constants and request maps;
- WorkManager definitions;
- Firebase service implementations;
- notification and sensor-service code paths.

JADX processed 11,396 classes and reported warnings or decompilation errors in 75 methods. Endpoint
names, literal request keys, resource values, schedules, and explicit SDK calls are considered direct
evidence. Meaning inferred only from obfuscated control flow is identified as an inference.

## 2. Evidence map

| APK artifact                 | Technical responsibility established by the artifact                               |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `AndroidManifest.xml`        | Components, permissions, SDK levels, full-screen intent, background services       |
| `res/values/strings.xml`     | Firebase identifiers, first-party server roots, localized configuration            |
| `MainActivity`               | Application initialization, identity linkage, SDK initialization, UI orchestration |
| `BootListener`               | Periodic worker scheduling after Android boot                                      |
| `UpgradeListener`            | Rescheduling and state handling after application updates                          |
| `WorkerFCMRegistration`      | Native FCM token acquisition and backend registration                              |
| `WorkerTopic`                | Geographic topic calculation and Firebase topic membership                         |
| `WorkerLocation`             | Background location acquisition and server synchronization                         |
| `WorkerSensors`              | Sensor-network worker lifecycle                                                    |
| `MyFirebaseMessagingService` | FCM data-message parsing and alert dispatch                                        |
| `AlertActivity`              | Full-screen real-time earthquake presentation                                      |
| `PlayerService`              | Earthquake alarm audio playback                                                    |
| Obfuscated HTTP helpers      | PHP endpoints, methods, content types, request fields, timeouts                    |

## 3. High-level architecture

The APK combines six subsystems:

1. **Native Firebase messaging** -- obtains an Android FCM registration token, subscribes the token
   to routing topics, receives data messages, and refreshes registration state.
2. **Earthquake Network backend** -- assigns a numeric network user/device ID, stores token and
   location state, accepts sensor detections, and serves earthquake/social data.
3. **Geographic routing** -- maps the current position into a 10 by 10 degree topic and maintains
   both global and regional subscriptions.
4. **Real-time alert engine** -- converts `eqn` messages into distance, expected intensity, warning
   time, notification, alarm, overlay, and full-screen alert behavior.
5. **Sensor detection network** -- samples phone sensors, derives windowed acceleration statistics,
   and uploads detection summaries associated with location and network identity.
6. **Community and monetization features** -- manual reports, profiles, public/private chat,
   friendship, moderation, advertising, and Google Play subscriptions.

The core earthquake data flow is:

```text
Android installation
  -> local network identity initialization
  -> Firebase Installations / native FCM token
  -> token + coordinates registered with first-party backend
  -> global and geographic topic subscription
  -> FCM data message received
  -> message type and fields parsed
  -> distance / intensity / filtering calculation
  -> notification, alarm, overlay, or full-screen activity
  -> last-event state persisted locally
```

The sensor contribution flow is separate:

```text
WorkManager
  -> sensor worker/service
  -> accelerometer sampling and local feature calculation
  -> location and device-state association
  -> form-encoded detection summary upload
  -> backend network aggregation
```

## 4. Firebase configuration

The following client configuration is embedded in Android resources:

| Field                      | Value                                       |
| -------------------------- | ------------------------------------------- |
| Firebase project ID        | `hybrid-bastion-406`                        |
| Project number / sender ID | `899482329945`                              |
| Android Firebase app ID    | `1:899482329945:android:e9ac57970038fe35`   |
| Android package            | `com.finazzi.distquake`                     |
| Realtime Database URL      | `https://hybrid-bastion-406.firebaseio.com` |

The APK also contains a Firebase client API key. This is normal Android client configuration and is
not a Firebase Admin credential or a server authorization key.

The application uses the native Android Firebase Messaging SDK and Google Play services.

## 5. Local identities and persistent state

The application maintains several identities with different scopes.

### 5.1 Firebase Installation ID

Firebase Installations creates a Firebase installation identity used internally by Firebase
Messaging and related Firebase SDKs. Its authentication lifecycle is managed by the Firebase Android
SDK.

### 5.2 Native FCM registration token

`FirebaseMessaging.getInstance().getToken()` is used to obtain the current Android FCM token. In the
obfuscated output, the call appears as:

```java
FirebaseMessaging.c().e()
```

The returned token is the value sent to the first-party backend as `r_id`.

### 5.3 Earthquake Network ID

The preference `android_id_eqn` stores a numeric identifier returned by the Earthquake Network
backend. Despite its name, this is not necessarily the operating system's secure Android ID. It acts
as the application's persistent first-party network identity and is sent as `u_id` in many requests.

`MainActivity` also assigns `android_id_eqn` as the Firebase Analytics user ID and Firebase
Crashlytics user ID. Consequently, first-party network activity, analytics, and crash diagnostics can
be correlated through the same numeric identity.

### 5.4 Relevant SharedPreferences keys

Verified keys include:

- `android_id_eqn`;
- `last_FCM_registered_token`;
- `last_FCM_registered_token_time`;
- `FCM_refresh`;
- `current_latitude`, `current_longitude`, `current_accuracy`;
- `current_location_time`;
- `topic_last_tile_subscribed`;
- `topic_last_latitude_subscribed`, `topic_last_longitude_subscribed`;
- `topic_global_subscribed`;
- `topic_tile_subscribed_successfully`;
- `topic_tile_unsubscribed_successfully`;
- `last_FCM_registered_topic_global_time`;
- `last_FCM_registered_topic_tile_time`;
- recent real-time event coordinates, magnitude, intensity, counter, code, and display state.

## 6. Startup, boot, and update scheduling

`BootListener` handles `android.intent.action.BOOT_COMPLETED` and recreates periodic WorkManager jobs.
The APK defines the following schedule:

| Worker                  | Repeat interval | Initial delay | Purpose                                       |
| ----------------------- | --------------: | ------------: | --------------------------------------------- |
| `WorkerLocation`        |      90 minutes |    10 minutes | Refresh current position and backend location |
| `WorkerFCMRegistration` |         8 hours |       8 hours | Validate token and backend registration       |
| `WorkerTopic`           |     180 minutes |    60 minutes | Refresh global and geographic topic state     |
| `WorkerPermission`      |         3 hours |    20 minutes | Check required permission/runtime conditions  |
| `WorkerSensors`         |      15 minutes |    15 minutes | Maintain sensor-network operation             |

The workers use network constraints. Update-related code also recreates or refreshes required work,
so registration and routing are not expected to depend only on a single first-launch execution.

## 7. FCM registration lifecycle

`WorkerFCMRegistration` reads:

- `FCM_refresh`;
- `current_latitude`;
- `current_longitude`;
- `android_id_eqn`;
- `last_FCM_registered_token_time`.

It obtains and uploads a token if any of these conditions is true:

```text
android_id_eqn == "0"
OR FCM_refresh == true
OR now - last_FCM_registered_token_time > 2,600,000,000 ms
```

The constant is approximately 30.1 days. The worker itself runs every eight hours, but the backend
token upload is normally suppressed until registration is missing, explicitly marked stale, or older
than the long refresh threshold.

The registration request is form-encoded:

```http
POST /distquake_upload_gcm_regid2.php HTTP/1.1
Host: srv.earthquakenetwork.it
Content-Type: application/x-www-form-urlencoded;charset=utf-8

u_id=<android_id_eqn-or-0>&r_id=<native-fcm-token>&lat=<latitude>&lon=<longitude>
```

The same endpoint is called from the token-refresh callback in `MyFirebaseMessagingService`. If the
device is offline or registration fails, `FCM_refresh` remains or becomes true so a later worker run
can retry. A successful numeric backend response is persisted as `android_id_eqn`; success time and
token state are also stored.

## 8. Topic routing

### 8.1 Topic calculation

`WorkerTopic.b(latitude, longitude)` calculates the geographic topic as:

```text
x{floor((longitude + 180) / 10)}y{floor((latitude + 90) / 10)}
```

This partitions the world into 10-degree longitude by 10-degree latitude cells. For example:

```text
latitude  = 40
longitude = 32
topic     = x21y13
```

### 8.2 Firebase membership

The application performs native Firebase topic operations equivalent to:

```java
FirebaseMessaging.getInstance().subscribeToTopic("global");
FirebaseMessaging.getInstance().subscribeToTopic(tile);
```

In this APK's bundled Firebase Messaging SDK, the operation resolves to the installation-scoped
client request below rather than an Admin SDK call:

```http
POST https://fcmregistrations.googleapis.com/v1/projects/<project-id>/registrations/<fid>/topicSubscriptions/<topic>:subscribe
x-goog-api-key: <firebase-api-key>
x-goog-firebase-installations-auth: <installation-auth-token>
```

Unsubscription uses the same URL with the `:unsubscribe` suffix. A 2xx response completes the
queued topic task; 403/404 responses fail it and 5xx/service-unavailable responses are retried by
the Android SDK.

If the user has moved to a different region, the previous tile can be unsubscribed before the new
tile is subscribed. The geographic subscription is refreshed when no successful tile state exists,
when state is stale, or when the stored and current positions differ enough to require a routing
change. The location logic uses an approximately 100 km movement threshold to avoid unnecessary
subscription churn.

The worker records separate success flags and timestamps for global and tile subscriptions. A
30.1-day staleness threshold is also used for topic refresh state.

### 8.3 First-party tile synchronization

Firebase topic membership and first-party backend tile state are distinct operations. The APK also
sends:

```http
POST /distquake_update_tile.php HTTP/1.1
Content-Type: application/x-www-form-urlencoded;charset=utf-8

u_id=<android_id_eqn>&tile=<xNyN-or-empty>
```

This allows the Earthquake Network backend to retain geographic routing metadata independently of
Firebase's own topic membership database.

## 9. Incoming FCM protocol

`MyFirebaseMessagingService` receives FCM data messages, removes Google control keys such as
`google.*`, `gcm.*`, `from`, `message_type`, and `collapse_key`, then dispatches on the application
field named `type`.

### 9.1 `type=eqn`: real-time network alert

Verified payload fields:

| Field        | Parsed type                  | Role                                                           |
| ------------ | ---------------------------- | -------------------------------------------------------------- |
| `latitude`   | double                       | Detection or estimated epicentral latitude                     |
| `longitude`  | double                       | Detection or estimated epicentral longitude                    |
| `counter`    | integer                      | Detection/report counter                                       |
| `datetime`   | string                       | Event time supplied by the service                             |
| `wave_speed` | float                        | Wave propagation speed used by alert visualization/calculation |
| `delay`      | float                        | Alert transport/processing delay                               |
| `intensity`  | integer                      | Source intensity classification                                |
| `test`       | integer                      | Test-event marker                                              |
| `peak`       | float                        | Peak acceleration-related value                                |
| `location`   | string                       | Human-readable event location                                  |
| `pos`        | integer                      | Position/state code                                            |
| `code`       | string                       | Alert identity used for updates                                |
| `upd`        | value parsed as update state | Alert revision/update marker                                   |
| `mag`        | numeric                      | Estimated magnitude                                            |

The real-time path:

1. Loads current position and alert preferences.
2. Computes great-circle distance using an Earth radius of 6,371 km.
3. Estimates expected intensity at the user's location.
4. Computes warning time from distance, wave speed, and message delay.
5. Determines whether the event is new or an update using event code/update state.
6. Persists the latest event fields.
7. Selects notification, alarm, overlay, dialog, or full-screen behavior.

The code contains an expected-intensity threshold of `1.5`. Events below that local expected
intensity are treated as no meaningful shaking and may not produce the real-time alarm presentation.
UI intensity bands observed in the code are approximately:

| Expected local intensity | Presentation class |
| -----------------------: | ------------------ |
|                  `< 1.5` | No shaking         |
|           `1.5 .. < 3.0` | Mild               |
|           `3.0 .. < 4.5` | Moderate           |
|                 `>= 4.5` | Strong             |

The alert engine can acquire a wake lock, post a high-priority notification, launch
`AlertActivity`, display an overlay/dialog, vibrate, and start `PlayerService`. Event updates are
broadcast internally using the event code and revised magnitude/intensity.

### 9.2 `type=manual`: community report

Verified fields:

- `latitude`;
- `longitude`;
- `place`.

The application calculates the distance from the current user location and applies the configured
manual-report notification radius. The default observed fallback radius is 1,000 km. Manual report
notification and text-to-speech behavior have independent preferences in the Android application.

### 9.3 `type=official`: official seismic-network event

Verified fields:

| Field                   | Role                                     |
| ----------------------- | ---------------------------------------- |
| `latitude`, `longitude` | Epicenter                                |
| `magnitude`             | Reported magnitude                       |
| `magnitude_range`       | Magnitude uncertainty/range              |
| `reports`               | Number of contributing reports           |
| `data`                  | Provider-specific event data/time string |
| `place`                 | Human-readable location                  |
| `provider`              | Seismic data provider                    |

This path handles conventional seismic-network notifications. It applies user preferences such as
minimum magnitude and maximum distance, formats metric or imperial distance, and builds the
notification content.

### 9.4 Social FCM types

The same FCM service also handles non-earthquake data messages:

- `chat_public` -- public channel message, sender metadata, country, moderation/PRO state;
- `chat_personal` -- direct message with sender and recipient identifiers;
- `friendship` -- friendship request/acceptance state and sender identity.

This confirms that FCM is a shared transport for both emergency and community features.

## 10. Location subsystem

The application stores:

```text
current_latitude
current_longitude
current_accuracy
current_location_time
```

Location is used for:

- geographic FCM topic calculation;
- backend routing metadata;
- event distance and direction;
- expected local intensity;
- warning-time calculation;
- manual report radius filtering;
- sensor detection uploads.

`MyFirebaseMessagingService` considers a stored location usable only when both coordinates are
non-zero and the location age is below 345,600 seconds, or four days. Background location workers
refresh state more frequently under normal operation.

Location synchronization uses:

```http
POST /distquake_upload_gcm_latlon.php
Content-Type: application/x-www-form-urlencoded;charset=utf-8

u_id=<network-id>&lat=<latitude>&lon=<longitude>&acc=<accuracy>&upd=<0-or-1>
```

`upd` becomes `1` when the new position differs from the previous server-relevant position by at
least approximately 0.1 degree on either axis.

## 11. Sensor detection network

The APK is not only a notification client. It contains a phone-based earthquake detection
subsystem. WorkManager periodically maintains sensor processing, and foreground/background service
components support sustained operation under Android restrictions.

The sensor pipeline derives summarized measurements rather than sending an obvious raw continuous
accelerometer array in the principal detection request. The verified request fields for
`distquake_upload4.php` are:

```text
e_t, u_id, lat, lon, a_max, a_std, c_std, pf, pr, acc,
d_not, cal, sht, ch, s_on, r_not, mon, ver, and
```

Directly supported interpretations:

| Field            | Meaning                                                                     |
| ---------------- | --------------------------------------------------------------------------- |
| `u_id`           | Persistent Earthquake Network identity                                      |
| `lat`, `lon`     | Detection position                                                          |
| `acc`            | Location accuracy                                                           |
| `a_max`          | Maximum acceleration-related value in the observation window                |
| `a_std`, `c_std` | Standard-deviation/distribution metrics derived from sensor samples         |
| `d_not`          | Timing difference between detection and later processing/notification stage |
| `ver`            | Application version code                                                    |
| `and`            | Android API level                                                           |

Fields such as `cal`, `s_on`, `r_not`, `ch`, `pf`, `pr`, `sht`, and `mon` encode calibration,
sensor, power/runtime, channel, or device-state metadata. Their exact business names cannot all be
proven from the R8-obfuscated variable names, so assigning more specific meanings would be
speculative.

The important architectural property is that sensor summaries are linked to a persistent network
ID and location. The backend can therefore aggregate detections from multiple devices and determine
whether a coherent earthquake signal exists.

## 12. First-party network API inventory

### 12.1 Server roots

Embedded resources define:

```text
https://srv.earthquakenetwork.it/
https://%s.earthquakenetwork.it/
https://cdn.earthquakenetwork.it/
```

Most write operations use form-encoded HTTPS POST requests. Some read operations select a dynamic
Earthquake Network subdomain. The manifest sets `android:usesCleartextTraffic="true"`, although the
verified first-party roots are HTTPS.

### 12.2 Messaging, identity, and location

| Endpoint                          | Method    | Verified fields                    |
| --------------------------------- | --------- | ---------------------------------- |
| `distquake_upload_gcm_regid2.php` | POST form | `u_id`, `r_id`, `lat`, `lon`       |
| `distquake_update_tile.php`       | POST form | `u_id`, `tile`                     |
| `distquake_upload_gcm_latlon.php` | POST form | `u_id`, `lat`, `lon`, `acc`, `upd` |
| `distquake_upload_testalarm.php`  | POST form | `u_id`, `radius`, `lat`, `lon`     |

### 12.3 Sensor and earthquake reports

| Endpoint                               | Method    | Verified fields                                             |
| -------------------------------------- | --------- | ----------------------------------------------------------- |
| `distquake_upload4.php`                | POST form | Sensor summary fields listed in section 11                  |
| `distquake_upload_manual5.php`         | POST form | `u_id`, `lat`, `lon`, `mag`, `address`, `cp1`, `cp2`, `cp3` |
| `distquake_download_areacheck.php`     | Request   | `lat`, `lon`                                                |
| `distquake_download_alertposition.php` | Request   | `lat`, `lon`, `dis`, `top10k`, `top100k`                    |

`cp1`, `cp2`, and `cp3` are client-generated control values derived from coordinates and randomized
inputs. Their presence indicates server-side validation or anti-abuse checks for manual reports.

Verified earthquake data endpoints also include:

- `distquake_download_automatic21.php`;
- `distquake_download_manual3.php`;
- `distquake_download_pastquakes_1m.php`;
- `distquake_download_pastquake_detail2.php`;
- `distquake_download_shakemap.php`;
- `distquake_count_redis3.php`.

### 12.4 Profile and account

| Endpoint                                 | Verified fields                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `distquake_register5.php`                | `u_id`, `nick`, `uID`, `wal`, `country`, `birth`, `town`, `sex`, `fr`, `pro` |
| `distquake_upload_profile2.php`          | `nick`, `uID`, `country`, `birth`, `town`, `sex`, `fr`                       |
| `distquake_download_userprofile2.php`    | `uID`                                                                        |
| `distquake_dowload_otheruserprofile.php` | `user_code`                                                                  |
| `distquake_upload_deleteprofile.php`     | `uID`                                                                        |
| `distquake_download_linknick.php`        | `u_id`, `uID`                                                                |

The profile layer can associate nickname, Firebase/Auth identity, country, birth date, town, sex,
friendship preferences, wallet/account metadata, and PRO status.

### 12.5 Chat, friendship, and moderation

| Endpoint                                 | Principal verified fields                                                                          |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `distquake_upload_chat3.php`             | `u_id`, `message`, `nick`, `postfix`, `u_code`, `msg_code`, `ver`, `pro`, `uID`, `wal`, `ch`, `ac` |
| `distquake_upload_personal_chat2.php`    | `u_id`, `user_code_from`, `user_code_to`, `message`, `nick`                                        |
| `distquake_upload_online3.php`           | `postfix`, `nick`, `u_code`, `u_id`, `pro`                                                         |
| `distquake_upload_friend_request.php`    | User codes/nicknames, `u_id`, `wal`                                                                |
| `distquake_upload_friend_accept.php`     | User codes/nicknames, `u_id`, `randcode`                                                           |
| `distquake_upload_friend_decline.php`    | User codes, `u_id`, `randcode`                                                                     |
| `distquake_upload_friend_remove_*`       | User codes, `u_id`, `randcode`                                                                     |
| `distquake_upload_friend_misconduct.php` | `nick_from`, `nick_to`                                                                             |
| `distquake_upload_report_user.php`       | `nick`, `nick_self`, `u_id`, `user_code`, `postfix`                                                |
| `distquake_ban_user2.php`                | `u_id`, `password_ban`, `user_code`, `nick`, `uID`, `postfix`                                      |

Read endpoints include `distquake_download_chat6.php`,
`distquake_download_chat6_cache.php`, `distquake_download_online3.php`, and
`distquake_download_friendship.php`.

### 12.6 Purchases and subscription state

| Endpoint                                           | Verified fields                          |
| -------------------------------------------------- | ---------------------------------------- |
| `distquake_upload_subscription.php`                | `u_id`, `token_sub`, `wallet_sub`, `sku` |
| `distquake_upload_pro_upgraded.php`                | `u_id`, `token_sub`, `wallet_sub`, `sku` |
| `distquake_update_subscription_and_pro_status.php` | `u_id`, `pro`, `top10k`, `top100k`       |

Google Play purchase/subscription tokens and product/order-related identifiers are sent to the
first-party backend for entitlement verification. Payment-card data is not processed directly by
the APK; billing is delegated to Google Play Billing.

## 13. Notification and alarm architecture

The application has multiple notification channels and presentation modes because real-time early
warning and conventional earthquake reports have different urgency requirements.

The real-time path can use:

- a high-priority notification;
- `USE_FULL_SCREEN_INTENT`;
- `SYSTEM_ALERT_WINDOW` overlay capability;
- `AlertActivity` for the map/countdown view;
- a wake lock to turn on or keep the device responsive;
- vibration;
- `PlayerService` for alarm audio;
- internal broadcasts to update an already visible alert.

The code stores `recent_notification` timestamps and uses stable notification tags/IDs for certain
event classes. Real-time alert updates reuse the alert code and can revise magnitude or expected
local intensity without treating every revision as an independent earthquake.

Alarm sound selection and text-to-speech preferences exist in the Android APK. A mild-event setting
can suppress alarm sound when expected local intensity is below `3.0`. Text-to-speech is separately
implemented for real-time and manual-report paths.

## 14. Third-party SDKs and data exposure

### 14.1 Firebase and Google

The APK includes or initializes:

- Firebase Cloud Messaging;
- Firebase Installations;
- Firebase Analytics;
- Firebase Crashlytics;
- Firebase Performance Monitoring;
- Firebase Authentication and FirebaseUI Auth;
- Firebase Realtime Database configuration;
- Firebase In-App Messaging;
- Firebase Remote Config components;
- Google Maps;
- Google Mobile Ads / AdMob;
- Google Play Billing;
- Google Play Install Referrer.

As noted earlier, `android_id_eqn` is assigned as the Analytics and Crashlytics user ID. This is a
directly verified correlation mechanism.

The manifest includes Advertising ID and Android AdServices attribution, ID, topics, and custom
audience permissions. AdMob initialization and advertising-ID access code are present.

### 14.2 Meta/Facebook

Facebook SDK, Facebook Authentication, and Audience Network components are present. Facebook app ID
and client-token metadata are embedded in the manifest/resources. Depending on feature use and SDK
configuration, authentication profile data, advertising identifiers, tracker data, and usage events
may be processed by Meta services.

### 14.3 TikTok Business SDK

`MainActivity` calls `TikTokBusinessSdk.initializeSdk()` and contains TikTok app ID:

```text
7198866571375214594
```

This proves SDK initialization in the analyzed 2026 APK. Static analysis alone does not establish
the exact runtime event set transmitted by the SDK.

### 14.4 Publisher declarations

The Google Play Data Safety declaration states that the application may collect location, personal
information, and other data categories, and may share personal information, application activity,
and application/performance information. It also states that data is encrypted in transit and that
deletion requests are available.

The published Iubenda privacy policy lists trackers, usage data, advertising identifiers, precise
but non-continuous location, purchase history, AdMob, Facebook Audience Network, Google Analytics,
Facebook Authentication, and Google OAuth. Its displayed last-update date predates the TikTok SDK
observed in this APK, so the policy and current binary are not fully synchronized.

## 15. Android permissions and runtime capabilities

| Permission/capability                            | Observed purpose                                        |
| ------------------------------------------------ | ------------------------------------------------------- |
| `INTERNET`, `ACCESS_NETWORK_STATE`               | First-party API, Firebase, ads, maps, authentication    |
| `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION` | Routing tile, distance, local intensity, sensor reports |
| `ACCESS_BACKGROUND_LOCATION`                     | Periodic location and sensor operation                  |
| `ACCESS_WIFI_STATE`, `CHANGE_WIFI_STATE`         | Connectivity and sensor-runtime conditions              |
| `RECEIVE_BOOT_COMPLETED`                         | Recreate WorkManager jobs after boot                    |
| `FOREGROUND_SERVICE*`                            | Sustained sensor/media/location operation               |
| `WAKE_LOCK`                                      | Time-critical real-time alert presentation              |
| `SYSTEM_ALERT_WINDOW`                            | Overlay alert presentation                              |
| `USE_FULL_SCREEN_INTENT`                         | Full-screen earthquake warning                          |
| `POST_NOTIFICATIONS`, `VIBRATE`                  | Notifications and vibration                             |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`           | Improve background detection continuity                 |
| `AD_ID`, `ACCESS_ADSERVICES_*`                   | Advertising and attribution                             |
| `BILLING`                                        | Google Play purchases and subscriptions                 |
| `com.google.android.c2dm.permission.RECEIVE`     | Native Android FCM delivery                             |
| `READ_GSERVICES`                                 | Google services integration                             |

The manifest declares accelerometer, gyroscope, compass, GPS, camera, microphone, NFC, and telephony
as optional hardware features. An optional feature declaration does not prove collection. GPS and
motion-sensor use are confirmed by application code. This analysis found no evidence that camera or
microphone data is part of the earthquake notification or sensor-upload protocol.

## 16. Security observations

- Firebase app ID, sender ID, project ID, and client API key are public client configuration, not
  administrative secrets.
- FCM registration tokens, first-party network IDs, purchase tokens, and authentication identifiers
  remain sensitive because they identify an installation or authorize a delivery/account flow.
- Location, network identity, sensor summaries, analytics identity, and crash identity can be linked
  through `android_id_eqn`.
- First-party endpoints observed in resources use HTTPS, but `usesCleartextTraffic=true` broadens the
  process's ability to use unencrypted HTTP if another code path requests it.
- The application includes several large third-party SDK surfaces. Static presence does not prove
  every optional SDK feature transmits data, but explicit initialization is stronger evidence than
  library presence alone.
- R8 obfuscation makes implementation harder to inspect but does not hide endpoint strings, request
  field names, manifest capabilities, or embedded client configuration.

## 17. System conclusions

Earthquake Network is a distributed mobile sensing and alert system, not merely a conventional
earthquake-feed viewer. Its key operating model is:

1. Register each Android installation with native FCM and a first-party numeric network identity.
2. Route messages globally and geographically through Firebase topics.
3. Track enough user location state to calculate relevance, distance, expected intensity, and
   warning time.
4. Receive both crowdsensed real-time alerts and conventional official seismic events through a
   shared FCM data-message service.
5. Use Android urgency primitives -- wake locks, full-screen intents, overlay windows, foreground
   services, vibration, and alarm audio -- for early-warning delivery.
6. Turn participating phones into sensor nodes by uploading acceleration-derived summaries with
   location and persistent network identity.
7. Add a separate community platform for manual reports, profiles, chat, friendship, moderation,
   advertising, and subscriptions.

The FCM token registration endpoint and Firebase topic subscriptions are both required pieces of the
routing design, but they serve different databases: the first-party backend stores installation and
location identity, while Firebase manages actual push-delivery membership. The geographic tile
endpoint mirrors routing state on the first-party side.

## 18. Analysis limitations

- This is static analysis. No TLS interception or live backend transaction capture was performed.
- R8-obfuscated branches may contain edge cases that JADX reconstructed imperfectly.
- Server-side validation, aggregation algorithms, earthquake-detection thresholds, and topic publish
  logic cannot be recovered from the client APK alone.
- Embedded third-party SDK code does not prove that every SDK event is sent for every user. Explicit
  initialization, direct calls, manifest metadata, and publisher declarations are reported
  separately to preserve evidence strength.
- Endpoint contracts can change independently of the analyzed APK version.

## 19. External reference material

- [Earthquake Network on Google Play](https://play.google.com/store/apps/details?id=com.finazzi.distquake&hl=en)
- [Earthquake Network package on APKPure](https://apkpure.net/earthquake-network/com.finazzi.distquake)
- [Earthquake Network package and certificate history on APKMirror](https://www.apkmirror.com/apk/futura-innovation-srl/earthquake-network/)
- [Published Earthquake Network privacy policy](https://www.iubenda.com/privacy-policy/45102664)
- [Firebase Cloud Messaging for Android](https://firebase.google.com/docs/cloud-messaging/android/get-started)
- [Firebase Android `FirebaseMessaging` API](https://firebase.google.com/docs/reference/android/com/google/firebase/messaging/FirebaseMessaging)
- [Firebase topic subscription documentation](https://firebase.google.com/docs/cloud-messaging/manage-topic-subscriptions)
