# WOOP goals: design notes

These are the open source notes for the **Goals** tab: what it does, why it's built this way, and how each part works, so you can check it, change it or reuse it. The code is MIT licensed with the rest of OS.

## The method

WOOP stands for **Wish, Outcome, Obstacle, Plan**. It comes from Gabriele Oettingen's research on mental contrasting and Peter Gollwitzer's on implementation intentions ("if-then plans"). The finding behind it: picturing a good result on its own tends to lower the energy to go after it, while picturing it and then the obstacle in the way, and planning for that obstacle, makes people more likely to act.

OS follows the published method. It isn't affiliated with or endorsed by its authors. For the method itself, see [woopmylife.org](https://woopmylife.org) and Oettingen's book *Rethinking Positive Thinking* (2014).

## The flow

One WOOP a week, in four steps, each on its own screen. A clock at the top counts up to 05:00, the time it should take.

| Step | What you do | Details |
|---|---|---|
| **Wish** | Write one specific goal for this week. | Up to 120 characters. The return key moves on. |
| **Outcome** | Picture the best result. | A 30-second countdown, then one optional line. The picture counts, not the writing. |
| **Obstacle** | Name what *inside you* will get in the way. | The loudest screen: brass border and the label "the step most people skip". You can't go on without it. Pick its kind (fatigue, distraction, procrastination, anxiety, perfectionism, overcommitment, other) and when it usually shows up (morning, afternoon, evening, night). |
| **Plan** | Finish "If [obstacle], then I will…". | The "if" half is written for you from the obstacle. You write the action. |

- **Always dark.** The flow uses the Lumen night palette whatever the phone is set to, so it reads as a quiet room apart from the rest of the app. The Goals tab itself follows the phone's light or dark setting, like every other screen.
- **Zero-friction inputs.** One field per screen, focused when the step opens. The obstacle step is the exception: it opens on its predictions, which the keyboard would cover. Tapping a prediction fills in the obstacle, its kind and its time.
- **Editing keeps the week.** Saving a WOOP for a week that has one edits it, and its check-ins stay.

## Daily check-in, streaks and the weekly review

- **Check-in.** Three switches on the Goals tab: *I moved the wish forward*, *The obstacle showed up*, *I followed my plan*. The last only counts on a day the obstacle showed up. Each tap saves.
- **Week strip.** Seven circles, Monday to Sunday. Filled: you moved the wish forward. Green ring: the obstacle showed up and you used the plan. Red: it showed up and you didn't.
- **Streaks.** Weeks in a row with a WOOP, your best run, and days in a row with a check-in. A streak holds until the current week, or day, is over, so it doesn't drop to zero on Monday morning. A strip shows the last 8 weeks.
- **Weekly review.** From Friday, the Goals tab asks how the week went: achieved, partly or missed, with an optional note. Last week's review stays open into the new week, since that's when people tend to do it.
- **Insights.** Your top obstacle, the share of weeks achieved, and the plan that held up best. Past weeks are listed with how often their plan held.

## AI, with history as the fallback

Both AI features use the same OpenRouter path as OKRs: your model first, then `openrouter/free`, with `provider: {data_collection: "deny"}` and reasoning off. Without a key, or when the AI fails, the same screen shows suggestions worked out on the phone from your history, and says why.

### Smart obstacle prediction

- **From history.** Every past week scores its obstacle's kind: half a point for naming it, plus one per day it showed up, weighted by 0.8 per week ago, so recent weeks count most. Your updates from the last 14 days add a point per mention of matching words, such as "exhausted" for fatigue or "scrolling" for distraction. The top three come back with the words you used last time and the time of day they usually hit. With no history, the common three (fatigue, distraction, procrastination) are timed for your energy peak: fatigue hits night owls in the morning and everyone else in the evening.
- **With AI.** The model gets the wish, your energy peak, up to 8 past weeks (obstacle, how often it showed up, plan, how often it was used, result), your recent updates with secrets removed, and the history ranking. It must name 3 *internal* obstacles as `obstacle | kind | when`. Lines with an unknown kind, such as blaming other people, are dropped.

### Plan optimization

- **Success rate.** A plan's rate is the share of days its obstacle showed up on which you used it. To rank plans, it's smoothed as `(used + 1) / (showed up + 2)`, so one lucky day isn't proof, plus 0.2 for a week marked achieved or 0.1 for partly.
- **From history.** Past plans for the same kind of obstacle that score at least 0.5, best first, topped up with common tactics for that kind, such as "set a 5-minute timer and start before it ends" for procrastination.
- **With AI.** The model sees the wish, the obstacle, your draft and every past plan with its rate. It writes 3 actions that start in under 2 minutes, begin with a verb and run under 12 words. Your best proven plan stays on the list next to them, with its rate shown.

### Contextual reminders

Local notifications only. Nothing is sent to a server.

- **The if-then plan, when the obstacle tends to show up.** Each remaining day of the week, at the time for its "when": morning 08:30, afternoon 14:00, evening 18:30, night 21:30, an hour earlier for early birds and an hour later for night owls (Settings → Energy). The notification is the plan itself, such as "If I'm too tired after work, then I will put on my shoes and run for 10 minutes."
- **Review on Sunday at 19:30**, until the week is reviewed.
- **Next week's WOOP on Monday at 09:00**, once you've used WOOP at least once. Nobody is asked for notification permission until then.
- **Kept fresh.** These are one-off dates, set again when you save, review or open the app. Tapping one opens the Goals tab. Brief reminders and WOOP reminders are tracked apart, so changing a schedule never clears your WOOP reminders, or the other way round.

## In your briefs

This week's WOOP is added to your goals as one line, such as "This week's WOOP: Run three times. If I'm too tired after work, then I will put on my shoes.", so Focus and the day plan can lean on it.

## Data and privacy

- **On the phone.** WOOPs and check-ins live in two SQLite tables, `woops` (one row per week) and `woop_checkins` (one row per WOOP and day). "Erase everything" removes both.
- **Sent to OpenRouter only when you ask** for a prediction or a plan, and only when an OpenRouter key is set. Updates are redacted first, and everything sits inside a `<data>` tag the model is told to treat as data, never instructions.

## Code

| File | What it holds |
|---|---|
| [app/src/core/woop.ts](../app/src/core/woop.ts) | The method's logic, with no UI: week math, summaries, streaks, insights, history-based predictions and plans, the if-then sentence, reminder times, and the AI prompts and parsers. |
| [app/src/core/db.ts](../app/src/core/db.ts) | The `woops` and `woop_checkins` tables. |
| [app/src/core/os.ts](../app/src/core/os.ts) | The API the screens call: `woop`, `saveWoop`, `checkIn`, `reviewWoop`, `predictObstacles`, `optimizePlan`, `syncWoopReminders`. |
| [app/src/WoopFlow.tsx](../app/src/WoopFlow.tsx) | The four-step flow. |
| [app/src/screens/Goals.tsx](../app/src/screens/Goals.tsx) | The Goals tab: this week, check-in, streaks, review and insights. |
| [app/src/device.ts](../app/src/device.ts) | Setting the notifications on the phone. |
| [app/test/woop.test.ts](../app/test/woop.test.ts) | Tests for all of the above. |

## Ideas welcome

Pull requests are welcome. Some open directions:

- More than one WOOP a week, for people who want a work and a personal one.
- A guided outcome step with audio, for people who'd rather close their eyes than read.
- Learning which time of day the obstacle actually shows up, from check-in times, rather than asking.
- Checking the reminders on real phones. The flow and dashboard have been run in the iOS Simulator, but no WOOP notification has fired on a device yet.
