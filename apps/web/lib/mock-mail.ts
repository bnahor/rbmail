export type AccountId = "personal" | "studio";

export type Message = {
  id: string;
  author: string;
  email: string;
  time: string;
  body: string;
  html?: string | null;
  outgoing?: boolean;
};

export type MailThread = {
  id: string;
  sender: string;
  initials: string;
  subject: string;
  preview: string;
  time: string;
  sortTime: number;
  account: AccountId;
  remoteAccountId?: string;
  sourceEmail?: string;
  provider?: "google" | "microsoft";
  unread: boolean;
  pinned?: boolean;
  tag?: string;
  avatarTone: string;
  messages: Message[];
};

export const accounts = {
  personal: {
    id: "personal" as const,
    label: "Personal",
    email: "robin@gmail.com",
    color: "#ff7557",
    unread: 4,
  },
  studio: {
    id: "studio" as const,
    label: "Studio",
    email: "rb@studio.co",
    color: "#4d72ff",
    unread: 3,
  },
};

export const initialThreads: MailThread[] = [
  {
    id: "launch",
    sender: "Maya Chen",
    initials: "MC",
    subject: "Re: launch notes & the tiny details",
    preview:
      "The interaction pass feels much closer. I left three notes on motion and the empty state.",
    time: "9:42",
    sortTime: 9,
    account: "studio",
    unread: true,
    pinned: true,
    tag: "Needs reply",
    avatarTone: "#d9f2cc",
    messages: [
      {
        id: "m1",
        author: "You",
        email: "rb@studio.co",
        time: "Yesterday, 18:04",
        body: "I pushed the interaction pass. I’m especially curious whether the transition into a thread feels immediate enough now.",
        outgoing: true,
      },
      {
        id: "m2",
        author: "Maya Chen",
        email: "maya@fieldwork.design",
        time: "Today, 09:42",
        body: "The interaction pass feels much closer. I left three notes on motion and the empty state.\n\nThe one thing I would protect: opening mail should feel like entering a conversation, not loading a document. If we keep that speed, the whole product clicks.",
      },
    ],
  },
  {
    id: "flight",
    sender: "Singapore Airlines",
    initials: "SQ",
    subject: "Your flight to Tokyo is confirmed",
    preview:
      "Booking reference K6RY2A · Singapore to Tokyo · 18 September",
    time: "8:16",
    sortTime: 8,
    account: "personal",
    unread: true,
    tag: "Travel",
    avatarTone: "#d7e4ff",
    messages: [
      {
        id: "sq1",
        author: "Singapore Airlines",
        email: "reservations@singaporeair.com",
        time: "Today, 08:16",
        body: "Your trip is confirmed.\n\nSingapore → Tokyo\n18 September · 08:05\nBooking reference K6RY2A\n\nWe look forward to welcoming you on board.",
      },
    ],
  },
  {
    id: "invoice",
    sender: "Nadia at Northstar",
    initials: "NN",
    subject: "Invoice 1048 — revised scope",
    preview:
      "Attached is the revised invoice with the research sprint removed, as discussed.",
    time: "Yesterday",
    sortTime: 7,
    account: "studio",
    unread: true,
    tag: "Finance",
    avatarTone: "#f5d7ec",
    messages: [
      {
        id: "n1",
        author: "Nadia at Northstar",
        email: "nadia@northstar.studio",
        time: "Yesterday, 16:31",
        body: "Hi Robin,\n\nAttached is the revised invoice with the research sprint removed, as discussed. The new total is S$8,400 and payment is due on 15 August.\n\nBest,\nNadia",
      },
    ],
  },
  {
    id: "dinner",
    sender: "Theo + 3",
    initials: "T+",
    subject: "Friday dinner",
    preview: "8pm works. Let’s do the little place on Keong Saik?",
    time: "Yesterday",
    sortTime: 6,
    account: "personal",
    unread: false,
    avatarTone: "#ffe2b6",
    messages: [
      {
        id: "d1",
        author: "Theo Martin",
        email: "theo@gmail.com",
        time: "Yesterday, 12:08",
        body: "8pm works. Let’s do the little place on Keong Saik?",
      },
      {
        id: "d2",
        author: "You",
        email: "robin@gmail.com",
        time: "Yesterday, 12:14",
        body: "Perfect. I’ll book us a table outside.",
        outgoing: true,
      },
    ],
  },
  {
    id: "github",
    sender: "GitHub",
    initials: "GH",
    subject: "[rbmail] Review requested on #184",
    preview: "alex-r requested your review on feat: incremental Gmail sync",
    time: "Mon",
    sortTime: 5,
    account: "studio",
    unread: false,
    tag: "Code",
    avatarTone: "#dadada",
    messages: [
      {
        id: "g1",
        author: "GitHub",
        email: "notifications@github.com",
        time: "Monday, 22:10",
        body: "alex-r requested your review on pull request #184:\n\nfeat: incremental Gmail sync\n\n12 files changed · +482 −91",
      },
    ],
  },
  {
    id: "bank",
    sender: "Wise",
    initials: "W",
    subject: "You received S$2,500",
    preview: "Northstar Studio sent you money. It’s now available in your balance.",
    time: "Mon",
    sortTime: 4,
    account: "personal",
    unread: true,
    tag: "Receipt",
    avatarTone: "#c8f5cf",
    messages: [
      {
        id: "w1",
        author: "Wise",
        email: "noreply@wise.com",
        time: "Monday, 14:02",
        body: "Northstar Studio sent you S$2,500.00. It’s now available in your SGD balance.",
      },
    ],
  },
  {
    id: "digest",
    sender: "Dense Discovery",
    initials: "DD",
    subject: "A slower kind of software",
    preview:
      "Issue 344: tools that reward attention, analogue interfaces, and a very good chair.",
    time: "Sun",
    sortTime: 3,
    account: "personal",
    unread: false,
    tag: "Read later",
    avatarTone: "#e7ddff",
    messages: [
      {
        id: "dd1",
        author: "Dense Discovery",
        email: "hello@densediscovery.com",
        time: "Sunday, 08:00",
        body: "Issue 344\n\nTools that reward attention, analogue interfaces, and a very good chair.\n\nThis week we’re thinking about software that leaves a little room for the person using it.",
      },
    ],
  },
];
