import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { openDatabaseSync } from 'expo-sqlite';
import { createComposioGateway } from './core/composio';
import { verifyOpenRouterKey } from './core/compose';
import { Store, type Schedule, type Secrets, type Sql } from './core/db';
import { isOldKey, migrateOldCopy } from './core/migrate';
import { createOs, type Os } from './core/os';
import { reminders } from './core/schedule';
import type { WoopReminder } from './core/woop';

const KIND_TITLE: Record<Schedule['kind'], string> = { morning: 'Morning brief', afternoon: 'Afternoon brief', evening: 'Evening brief', night: 'Night brief' };
const OLD_AI_KEY = 'os.offlineOpenRouterKey';
const OLD_CONNECTION = 'os.connection';

function openSql(): Sql {
  const db = openDatabaseSync('os.db');
  return {
    exec: (source) => db.execSync(source),
    run: (source, ...params) => {
      const result = db.runSync(source, params);
      return { changes: result.changes, lastInsertRowId: result.lastInsertRowId };
    },
    get: (source, ...params) => db.getFirstSync<Record<string, unknown>>(source, params),
    all: (source, ...params) => db.getAllSync<Record<string, unknown>>(source, params),
  };
}

/** API keys stay in the iOS Keychain or Android Keystore, readable only by this app on this device. */
const keychain: Secrets = {
  get: (key) => SecureStore.getItem(`os.secret.${key}`),
  set: (key, value) => SecureStore.setItem(`os.secret.${key}`, value),
  delete: (key) => void SecureStore.deleteItemAsync(`os.secret.${key}`),
};

/**
 * Sets one weekly reminder per schedule and day. Tapping it opens the app, which writes the brief.
 * Asks for permission the first time there's a schedule. Without permission, briefs are still
 * written when you open the app after the time.
 */
export async function setReminders(schedules: Schedule[]): Promise<void> {
  try {
    await cancelWhere((woop) => !woop);
    const wanted = reminders(schedules);
    if (!wanted.length) return;
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && !(await Notifications.requestPermissionsAsync()).granted) return;
    for (const r of wanted) {
      await Notifications.scheduleNotificationAsync({
        content: { title: KIND_TITLE[r.kind], body: 'Open OS to write it.', data: { scheduleId: r.scheduleId } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: r.weekday, hour: r.hour, minute: r.minute },
      });
    }
  } catch {
    // Reminders are a convenience. A failure here never stops the schedule itself.
  }
}

/** Brief reminders and WOOP reminders are set apart, so setting one never clears the other. */
async function cancelWhere(match: (isWoop: boolean) => boolean): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of scheduled) {
    if (match(n.content.data?.woop === true)) await Notifications.cancelScheduledNotificationAsync(n.identifier);
  }
}

/**
 * Sets the WOOP reminders: the if-then plan at the hour the obstacle tends to show up, and the
 * review and next-week nudges. They're one-off dates, set again whenever the app opens.
 */
export async function setWoopReminders(list: WoopReminder[]): Promise<void> {
  try {
    await cancelWhere((woop) => woop);
    if (!list.length) return;
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && !(await Notifications.requestPermissionsAsync()).granted) return;
    for (const r of list) {
      await Notifications.scheduleNotificationAsync({
        identifier: r.id,
        content: { title: r.title, body: r.body, data: { woop: true } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.at },
      });
    }
  } catch {
    // Reminders are a convenience. WOOP works without them.
  }
}

/** Moves the copy the app kept when it read from your Mac into this phone's store, then removes it. */
async function migrate(store: Store): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter(isOldKey);
    const entries = (await AsyncStorage.multiGet(keys)) as Array<[string, string | null]>;
    const openRouterKey = await SecureStore.getItemAsync(OLD_AI_KEY).catch(() => null);
    migrateOldCopy(store, { entries, openRouterKey });
    if (keys.length) await AsyncStorage.multiRemove(keys);
    await SecureStore.deleteItemAsync(OLD_AI_KEY).catch(() => undefined);
    // The old server address and token. Nothing uses them now.
    await SecureStore.deleteItemAsync(OLD_CONNECTION).catch(() => undefined);
  } catch {
    // The old copy is left in place, and the next start tries again.
  }
}

let os: Promise<Os> | null = null;

/** The one OS instance on this phone, created on first use. */
export function openOs(): Promise<Os> {
  os ??= (async () => {
    const store = new Store(openSql(), keychain);
    await migrate(store);
    const instance = createOs({
      store,
      createGateway: (apiKey) => createComposioGateway(apiKey),
      verifyOpenRouterKey,
      onSchedulesChanged: (schedules) => void setReminders(schedules),
      onWoopChanged: (list) => void setWoopReminders(list),
    });
    void setReminders(instance.listSchedules()).then(() => instance.syncWoopReminders());
    return instance;
  })();
  return os;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});
