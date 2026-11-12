// What each setting DOES, in plain words, and whether it does it yet. the team, 2026-11-10: "don't define tabs in the settings menu, only define the actions, so people know what they are doing
// when they do it". So there is no text under a tab name; every control says what happens when you use it, and a control that only saves a choice (nothing reads it yet) says so.
// live: true = the page or server really changes behavior; false = saved in this browser only ("Not active yet" badge). Keep this honest: a test checks every label has an entry.
export const COPY = Object.freeze({
  // Account
  'Profile photo': { live: false, text: 'Your initial is shown next to your name. Picture upload is not available yet.' },
  'Full name': { live: true, text: 'Changes the name shown next to your messages and in the sidebar, on this device.' },
  'What should VESPR call you?': { live: true, text: 'Changes the short name used in greetings, on this device.' },
  'What best describes your work?': { live: false, text: 'Saves your answer. Nothing uses it yet.' },
  'Organization ID': { live: true, text: 'The id of your organization, for support requests. Read only.' },
  "Where you're logged in": { live: true, text: 'The browsers and apps signed in to your account, as the server knows them. "Sign out" ends that one session.' },
  // Billing / usage
  'Your plan': { live: true, text: 'Shows your current plan. Paid plans are not open yet, so nothing is charged.' },
  'Payment method': { live: true, text: 'Shows how you pay. When paid plans open you pay on Stripe\'s page; VESPR never sees or stores card details.' },
  'Invoices': { live: true, text: 'Lists what you have been billed. Nothing has been billed yet.' },
  'Model usage': { live: true, text: '"See usage" opens the record of every model call made for your account.' },
  'Server Token Ledger (Past 30 Days)': { live: true, text: 'Totals recorded by the server for your account: calls, tokens and cost. Zero when you have made no calls.' },
  'Plan limits': { live: true, text: 'No limits are enforced yet, so no usage bar is shown.' },
  // Appearance
  'Color theme': { live: true, text: 'Switches the whole app between dark and light, or follows your computer.' },
  'Glass effects': { live: true, text: 'On: menus, dialogs and the composer are see-through glass. Off: they are solid, which is also lighter on slow computers.' },
  'Chat glow': { live: true, text: 'On: a soft light glows in the middle of a chat in the color of the agent. Off: a plain gray chat.' },
  'Look': { live: true, text: 'Changes the whole look of the app to one of 30 renditions: button shapes, sidebar, top bar, chat surface, message box, spacing and highlight color. Default puts it back.' },
  'Sidebar width': { live: true, text: 'Changes how wide the left sidebar is on larger windows. Small windows always use a narrower one.' },
  'Font scaling': { live: false, text: 'Would make text larger or smaller. Saved only; the app does not use it yet.' },
  'Code syntax theme': { live: false, text: 'Would recolor code in the editor. Saved only; the editor does not use it yet.' },
  'High contrast mode': { live: true, text: 'On: borders and secondary text become stronger so they are easier to see.' },
  'Reduced motion': { live: true, text: 'On: animations and transitions are switched off.' },
  // Your AI
  'Persona tone': { live: true, text: 'Changes how the AI answers in your AI chats (short and technical, architect, thorough, or pair programmer). Sent with each message you send in an AI chat.' },
  'Custom instructions': { live: true, text: 'Text added to every AI chat message you send, up to 600 characters. It cannot override the assistant\'s built-in rules.' },
  'Automatic convention extraction': { live: false, text: 'Would let the AI learn naming and formatting rules from a repository. Saved only; nothing reads it yet.' },
  'Memory retention': { live: false, text: 'Would let the AI remember a workspace between chats. Saved only; nothing reads it yet.' },
  // Capabilities
  'Autonomous swarm workers': { live: false, text: 'Would let background helpers work without asking. Saved only; agents decide by the workspace\'s permission mode instead.' },
  'Web search reach': { live: false, text: 'Would limit how far web searches may reach. Saved only; agents do not read it yet.' },
  'Sandbox backend': { live: false, text: 'Would choose where code runs. Saved only; each workspace picks its own runner.' },
  // Notifications
  'Audio chimes': { live: false, text: 'Would play a sound when a task finishes. No sound is played yet.' },
  'Sound theme': { live: false, text: 'Would choose the chime sound. No sound is played yet.' },
  'Desktop push alerts': { live: false, text: 'Would show desktop notifications. None are sent yet.' },
  'Email digests': { live: false, text: 'Would email a daily summary. No email is sent.' },
  'Webhook integration (Slack / Discord)': { live: false, text: 'Would post notifications to a channel. Nothing is posted.' },
  // Privacy (read-only statements)
  'Stays on this device': { live: true, text: 'Your AI chats, interface choices and file-access choices live only in this browser or app. Clearing site data removes them.' },
  'Sent when you send a message in a personal AI chat': { live: true, text: 'Sending a message sends it and the earlier turns of that chat to this server and its AI model provider. Nothing is sent to a workspace.' },
  'Shared when you work in a workspace': { live: true, text: 'Files, messages and agent actions in a workspace are visible to everyone allowed in it, and its history records who did what.' },
  'Direct and group messages': { live: true, text: 'Messages between people carry no code tools. Adding a file or folder is only offered when your organization allows it, and then read-only.' },
  'Model training': { live: true, text: 'VESPR does not train models. The model provider\'s own terms apply to what you send; ask the operator which one is in use.' },
  // Wellbeing
  'Pomodoro & break reminders': { live: true, text: 'On: while this tab is open, a reminder to take a break appears every break interval.' },
  'Break interval': { live: true, text: 'Sets how many minutes pass between break reminders (at least 5).' },
  'Eye comfort mode': { live: true, text: 'On: a warm tint is laid over the screen to reduce blue light at night.' },
  'Daily spend warning limit': { live: false, text: 'Would warn you when model spend passes an amount. Nothing is measured against it yet.' },
  // Chat & friends
  'Profile discovery': { live: false, text: 'Would control who can find you. This choice is not connected yet; today friends are added by handle.' },
  'Group chat instance deduplication': { live: false, text: 'Would reopen an existing group instead of making a duplicate. This switch is not connected yet.' },
  'Bot assistant command (/vespr)': { live: false, text: 'Would allow typing /vespr in a direct or group message to call the assistant. This switch is not connected yet.' },
  'Corporate workspace federation': { live: false, text: 'Would connect an organization\'s workspaces. This switch is not connected yet.' },
  // Chats & files
  'Your AI chats': { live: true, text: '"Export" downloads all your AI chats as a file. "Delete all" removes them from this device and cannot be undone.' },
  'Adding files to a message': { live: true, text: 'In direct and group messages, choose whether adding a file asks you each time, always works, or never works. A file is read once and never changed.' },
  'Adding folders to a message': { live: true, text: 'Same choice for folders. Keys, credentials and folders like node_modules are never read.' },
  'Organization setting: adding files': { live: true, text: 'Turns on or off adding files to messages for everyone in your organization. Off until an administrator turns it on.' },
  'Organization setting: adding folders': { live: true, text: 'Same for folders. Off until an administrator turns it on.' },
  // Messages dialog
  'Start a message': { live: true, text: 'Tick friends and press Start to open a private conversation with them. The same people always give the same conversation.' },
  'Friend requests': { live: true, text: 'Accept to become friends. Decline ignores the request.' },
  'Add a friend': { live: true, text: 'Sends a friend request to that handle. They can message you once they accept.' },
  // Code
  'Branch prefix': { live: false, text: 'Would start every branch VESPR creates with this text. Saved only; branch names do not use it yet.' },
  'Label sessions by status': { live: false, text: 'Would mark sessions as blocked, ready or done. Saved only.' },
  'Default transcript view': { live: false, text: 'Would choose how much detail new sessions show. Saved only.' },
  'Dynamic workflows': { live: false, text: 'Would let several agents work at once. Saved only; agents are started per request.' },
  'Prompt suggestions': { live: false, text: 'Would suggest a next prompt after a reply. Saved only.' },
  'Summary and next steps': { live: false, text: 'Would add a summary after an agent finishes. Saved only.' },
  'When you ask for an unrelated task': { live: false, text: 'Would choose what happens when you change topic in a session. Saved only.' },
  'Output style': { live: false, text: 'Would change how agents format answers. Saved only.' },
  'Active SDE model (Preview)': { live: false, text: 'Would choose the model. The server uses the model its operator configured.' },
  'Strict container sandbox fallback': { live: false, text: 'Would switch to a local model inside a locked-down sandbox. Saved only.' },
  'Pull requests': { live: false, text: 'Would open a pull request automatically after a push. Saved only; open them from the Git tab.' },
  'Usage by Model': { live: true, text: 'Splits your recorded model calls by model: calls, tokens and price.' },
  // Hosting, promotions
  'What is shown here': { live: true, text: 'This page shows only what your account\'s hosting reports. "Open Dashboard" opens it.' },
  'Promotions': { live: true, text: 'A sponsored item appears on the Chat home screen only when your account has one set up. Nothing on this page changes that yet, so there is nothing to switch off.' },
  'Navigation learning': { live: true, text: 'The app remembers which buttons you use, on this device only, to order shortcuts and search. No file contents are involved.' },
  // Cowork
  // Organization directory (nothing is connected: no GitHub organization, SCIM feed or roster provider is wired to the server)
  'GitHub organization sync': { live: false, text: 'Would map your GitHub organization\'s teams to VESPR roles. Not connected: nothing is synced.' },
  'Identity provider sync (SCIM)': { live: false, text: 'Would add and remove people automatically from a directory such as Okta. Not connected: nothing is synced.' },
  'School rosters (Clever, ClassLink)': { live: false, text: 'Would turn a school\'s class rosters into VESPR classes. Not connected: nothing is synced.' },
  'Collaborative pairing': { live: false, text: 'Would switch live co-editing on or off. Co-editing is always on in a shared workspace today.' },
  'Multiplayer cursor presence': { live: false, text: 'Would hide teammates\' cursors. They are always shown today.' },
  'Shared terminal sessions': { live: false, text: 'Would let teammates type in your terminal. Not available.' },
  'Real-time voice transcription': { live: false, text: 'Would turn speech into text in the composer. Not available.' },
  // Shortcuts
  'Keyboard Shortcuts (Editable)': { live: true, text: 'Click a key to change the shortcut for that action.' },
  'Mouse Click Customization': { live: false, text: 'Would change what a click does. Saved only.' },
  'Right-Click Action': { live: false, text: 'Would change what right-click does. Saved only.' },
  'Swap Mouse Click Buttons': { live: false, text: 'Would swap left and right click. Saved only.' },
  'Automated Workflow Macros': { live: false, text: 'Would record and replay a series of actions. Not available yet.' },
  // Desktop
  'The desktop app': { live: true, text: '"Reload this view" refreshes the app window.' },
  'This window': { live: true, text: '"Reload this view" refreshes the app window.' }
})
// the entry for a label as it appears in the page (long labels are cut; "(Local only)" style suffixes and trailing text are ignored)
export function copyFor (label) {
  const l = String(label == null ? '' : label).replace(/\s+/g, ' ').trim()
  if (Object.prototype.hasOwnProperty.call(COPY, l)) return COPY[l]
  const hit = Object.keys(COPY).find(k => l.startsWith(k)); return hit ? COPY[hit] : null
}
export const NOT_ACTIVE = 'Not active yet'
