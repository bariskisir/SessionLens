/**
 * Defines the public client configuration embedded by the authorized Earthquake Network APK.
 */

import type { Types } from '@eneris/push-receiver/dist/client'

/** Android package identity declared by the Earthquake Network APK. */
export const EARTHQUAKE_NETWORK_PACKAGE_ID = 'com.finazzi.distquake'

/** Firebase client identity read from the APK's generated google-services resources. */
export const EARTHQUAKE_NETWORK_FIREBASE_CONFIG = {
  projectId: 'hybrid-bastion-406',
  appId: '1:899482329945:android:e9ac57970038fe35',
  apiKey: 'AIzaSyAMOdMa4wXMaSE2tFvGNaQGumOgUA10q6s',
  messagingSenderId: '899482329945',
  databaseURL: 'https://hybrid-bastion-406.firebaseio.com',
  storageBucket: 'hybrid-bastion-406.appspot.com',
} satisfies Types.FirebaseConfig

export const EARTHQUAKE_NETWORK_REGISTER_URL =
  'https://srv.earthquakenetwork.it/distquake_upload_gcm_regid2.php'

export const EARTHQUAKE_NETWORK_UPDATE_TILE_URL =
  'https://srv.earthquakenetwork.it/distquake_update_tile.php'

export const EARTHQUAKE_NETWORK_UPDATE_LOCATION_URL =
  'https://srv.earthquakenetwork.it/distquake_upload_gcm_latlon.php'

/** Firebase Messaging client endpoint used by the APK for topic membership operations. */
export const FIREBASE_TOPIC_REGISTRATION_BASE_URL =
  'https://fcmregistrations.googleapis.com/v1/projects'

/** Builds the official FCM client URL for one installation topic operation. */
export const createFirebaseTopicMembershipUrl = (
  projectId: string,
  firebaseInstallationId: string,
  topic: string,
  operation: 'subscribe' | 'unsubscribe',
): string =>
  `${FIREBASE_TOPIC_REGISTRATION_BASE_URL}/${encodeURIComponent(projectId)}/registrations/${encodeURIComponent(firebaseInstallationId)}/topicSubscriptions/${encodeURIComponent(topic)}:${operation}`
