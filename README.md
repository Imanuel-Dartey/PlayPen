# PlayPen

A private watch-together room for me, my girlfriend and some of our friends. One of you picks a film or episode, and it
opens on both screens. Play, pause and seek apply to both of you, and the timeline shows
where each of you actually is. Next to the video there's a chat for messages, GIFs and photos,
and each of you can turn on subtitles in your own language. Browse lets you look around
separately and decide together, with ratings from IMDb, Rotten Tomatoes and Metacritic.

Video comes from the [frameXTV](https://framextv.cc/api) embed player. Sync between the two
browsers goes through a free Supabase Realtime channel, so the site itself is fully static
and can be hosted on Vercel's free tier.

## GIFs 

GIF search uses [KLIPY](https://docs.klipy.com). (Google shut down the Tenor API in June 2026.)
Sign up at the [KLIPY Partner Dashboard](https://partner.klipy.com), create an app, and set its
key as `VITE_KLIPY_APP_KEY`. Without a key, everything else works and the GIF button is hidden.

## Ratings 

Browse shows TMDB's score for every title. PlayPen looks each title up at
most once a week per device, only when its card is on screen, and stops at 800 a day per device.

## Using it

1. Enter your name and **Start a room**, then **Copy invite link** and send it.
2. Open **Browse** to find something (see below). "Watch together" opens it paused on both
   screens.
3. Use the bar under the video (or space, ←/→, F, M, C, E) to play, pause, seek, go full
   screen, turn subtitles on or off, and open the episode list.
   - Volume only affects your own screen. The **server** picker changes the stream source for
     both of you: servers can carry different cuts of the same episode (an extended version,
     say), and two different cuts can't be kept in step.
   - The **CC** button picks subtitles. See "Subtitles" below.
   - For shows, the **episodes** button opens the show's seasons beside the picture, with a
     still and a summary for each episode. Picking one starts it for both of you.
   - When an episode ends, the next one starts for both of you after a 10-second countdown.
     The card for it appears in the last 20 seconds; **Play now** skips ahead, and **Cancel**
     on either screen stops the countdown on both.
   - If an ad covers the video, press **Close an ad** (bottom right of the video), then click
     the ad's own button. See "Ads" below.
4. Chat sits beside the video (below it on phones) and stays there in full screen. Press Enter
   to send and Shift+Enter for a new line. Add photos with the photo button, by pasting, or by
   dragging them onto the chat. Hide the chat with its close button: new messages then show
   up as a short note over the video, plus a count on the Chat button.

## How the sync works

- Each browser keeps a copy of the room: what's on, and `{ playing, position, updatedAt }`.
  Every change carries a revision number, and the highest revision wins everywhere.
- The browsers agree on one clock: everyone measures their offset to the member whose id
  sorts first, so "playing since 21:04:03.250" means the same instant on both screens.
- Several times a second, each browser compares its player (via frameXTV's `timeupdate`
  messages) with where the room says it should be, and re-sends play/pause if they differ.
  This one loop also handles late joiners, reloads, and the embed switching servers.
- Small gaps are closed by **playing slightly faster or slower** (up to 6%, pitch unchanged)
  until the player is back within about 30 ms. The gap is measured as the median of the
  player's own time reports over the last 1.5s, so one late report can't trigger a
  correction. Gaps over 1s while playing (0.15s while paused) are closed by seeking instead.
  Each seek aims a little ahead to allow for buffering, and learns from where the last one
  landed.
- The bar shows how far apart your two screens are ("7 ms apart") while you both play. On
  one computer, two tabs settle within about 10 ms of each other. Between two devices, the
  clock alignment over the network adds some error, likely tens of milliseconds.
- Everyone uses the same stream server, because servers can carry different cuts. If the
  automatic choice still hands your screens different cuts (their lengths differ), a note
  over the video says so; pick a named server to fix it.
- A once-a-second heartbeat shares each person's position for the timeline, and repairs any
  broadcast that got lost.
- When nobody else is in the room, it's resumed from what this device last saw, paused.

## How chat works

- Each message is saved to the `messages` table first, then announced over the room's live
  channel, so both screens and the saved history always agree. If saving fails, the message
  is marked "Not sent" with a **Try again** button.
- History loads when you open the room, and loads again after any reconnect to pick up
  anything you missed. Older messages load as you ask for them.
- Every request names its room in an `x-room` header, and the table only returns or accepts
  rows for that room. The anon key on its own can't read anyone's chat.
- Photos are re-encoded in the browser before upload (longest side up to 2560px, WebP or
  JPEG). That keeps uploads small, strips location data, and turns iPhone HEIC photos into
  something every browser can show (sending HEIC needs Safari, the only browser that opens
  it). GIF files are sent untouched. The bucket accepts images only, up to 10 MB each.
- Your messages are recognized by an id stored in this browser. A different browser or
  device counts as a new person to the chat, even with the same name.

## Browse

- **Everything** shows rows of trending, top-rated and new films and shows that slowly rotate.
  Hovering (or tabbing into) a row pauses it. **See all** opens that list as a grid.
- **Films** and **Shows** are grids you can filter: trending, popular, top rated, or in
  cinemas / on the air, plus genre, year, minimum rating and sort order.
- **Search** at the top looks through films and shows together.
- You each browse on your own, but you can see each other: while your partner has Browse
  open, a strip shows what they're looking at, with **Jump there** to go to the same list
  and open the same title. The card they have open gets a ring in their color, and the
  title's page says when they're looking at it too. The Browse button shows a dot while
  they're browsing.
- The heart adds a title to the **shortlist**, which you share. It's saved with the room.
  Either of you can open a title from it and start it for both.
- Chat stays open beside Browse, and the video keeps playing (out of sight) while you look.

## Subtitles

- **CC** in the bar (or the C key) lists the subtitles frameXTV has for the title, from
  OpenSubtitles, grouped by language. "English 1" and "English 2" are different versions of
  the file, so if one is out of step with the picture, try the other.
- Subtitles are **just for you**: each of you picks your own language, or none, and it doesn't
  change the other screen.
- PlayPen remembers your language and turns it on for the next title when it's available.
  Size (Small, Medium, Large) is remembered too.
- **Timing**: if subtitles show up early or late, use **Earlier** or **Later** to shift them in
  half-second steps. The shift is remembered per title.
- **Another cut**: some servers play a different cut than the one the subtitles were made
  for. The automatic server for The Office, for example, plays Peacock's 32-minute extended
  episodes, while every subtitle file fits the 21-minute broadcast ones, so the subtitles run
  further ahead with every extra scene. PlayPen compares the length of the subtitles with the
  length of the stream, and when they don't fit it offers **Find a server that matches**. That
  loads each server out of sight and muted, a few at a time, and switches you both to the
  first one with a matching length.
- **Use a subtitle file** loads an `.srt` or `.vtt` from your computer, for when the list doesn't
  have what you want. It stays on this device.
- PlayPen draws the subtitles itself, over the picture, timed from the player's clock. They
  show in full screen and never get in the way of clicks.

## Ads

frameXTV's player loads a third-party ad script that PlayPen can't remove (it runs inside
frameXTV's page, which browsers don't let other sites change). What it does, and what PlayPen
does about it:

- **Pop-up and pop-under windows** opened on every click (to throwaway `.qpon`/`.cyou` ad
  domains), and attempts to redirect the page. The player is **sandboxed**
  (`sandbox="allow-scripts allow-same-origin"`), so the browser refuses both. If an ad ever
  navigates the player itself somewhere else, PlayPen notices and reloads the player at the
  room's current position.
- **Full-screen fake dialogs**, such as "Please install Opera GX to unlock the content" or
  "All-In-One Adblocker – Add to Chrome". The first one shows up about 12 seconds after a stream
  loads. Most have no close button; the only way out is the ad's own button. PlayPen normally
  catches clicks on the video (that's how click-to-pause works for both of you), so press
  **Close an ad** first. It lets your clicks through to the player for a few seconds after your
  latest one. Because of the sandbox, the ad's button can't open anything; clicking it just
  closes the ad. The first click is sometimes swallowed by an invisible ad layer, so a second
  click may be needed. The button shows on its own around the time the first ad appears, and
  on hover otherwise.
- The video keeps playing behind these ads, and closing one doesn't pause anyone.
- If the browser blocks autoplay, PlayPen offers **Press play in the player**, which lets one
  click through to the player's own play button in the same way.

## Known limits

- The frameXTV embed only reports the time, not play/pause, so playing vs. buffering is
  inferred from whether the time is moving.
- Some browsers (mostly Safari) block autoplay with sound in embedded players. If the video
  doesn't start, PlayPen offers to let you press play inside the player once.
- Anyone with a room link can join it and read its chat. Room codes are random enough not to
  be guessed, but don't post them publicly.
- Photo links are public URLs with random names, so anyone who has a link can open that
  photo. Uploading needs only the anon key, so in principle a stranger who read the key out of
  the page could put files into your bucket (they could never list or read your chat). For a
  two-person app that's an acceptable trade. The bucket's 10 MB and images-only limits cap it.
