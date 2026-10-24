// Everything the matcher and the AI offer writer know about you.
// Edit this file to tune what counts as a good lead.

export const PROFILE = {
  name: 'Anthony De Vera Jr',
  firstName: 'Anthony',
  company: 'Antheon',
  website: 'https://antheonph.com',
  email: 'anthony@antheonph.com',
  location: 'Cavite, Philippines (fully remote, works with AU, SG, UAE and PH clients)',

  // Used by the AI writer. Keep it factual: it is quoted back to prospects.
  summary: `Freelance developer and VA, founder of Antheon, a systems and process engineering company that treats websites, CRMs and automations as connected operational systems rather than standalone deliverables. Fully remote. Previously at NomuHub (Dec 2024 to Sep 2026), a fully remote travel and volunteering company, covering operations, marketing support and technical systems. Now available for new work. Best fit: small and mid-size businesses, especially Australian SME owners, who need their tools connected and automated.`,

  proofPoints: [
    'Built a real-time WeTravel webhook dashboard (Vercel, Google Sheets, Svix)',
    'Set up WhatsApp inquiry automation with ManyChat and Respond.io, including an AI agent answering from a knowledge base with escalation to humans',
    'CRM setup and clean-up in Zoho, HubSpot and Salesforce; swimlane process maps to lift lead-to-booking conversion',
    'Migrated 21 mailboxes from Google Workspace to Microsoft 365, including vendor sourcing and handoff',
    'Shopify theme debugging, popups, Klaviyo and Okendo integrations',
    'WordPress and Elementor builds and fixes; Squarespace to Vercel migrations',
    'Operations, compliance, marketing and booking dashboards in Excel and Google Sheets with timezone-aware overdue tracking',
    'Google Business Profile suspension appeals, reinstatement and Service Area Business conversion',
    'Meta Ads Manager budgets, campaign structure and reporting dashboards',
    'Custom Claude skills, browser automation and AI-assisted workflows for clients',
  ],
};

// [group, label, patterns, weight]. Patterns are regex sources, matched case-insensitively.
// Weight is how much one match is worth; title matches count roughly double.
export const SKILLS = [
  ['CRM', 'HubSpot', ['hubspot'], 10],
  ['CRM', 'Zoho', ['zoho'], 10],
  ['CRM', 'Salesforce', ['salesforce'], 7],
  ['CRM', 'GoHighLevel', ['gohighlevel', 'go ?high ?level', '\\bghl\\b'], 10],
  ['CRM', 'CRM', ['\\bcrms?\\b'], 8],
  ['CRM', 'Pipedrive / Keap', ['pipedrive', 'keap', 'infusionsoft', 'activecampaign'], 6],
  ['Automation', 'Zapier', ['zapier'], 10],
  ['Automation', 'Make.com', ['make\\.com', 'integromat'], 8],
  ['Automation', 'n8n', ['\\bn8n\\b'], 6],
  ['Automation', 'ManyChat', ['manychat'], 10],
  ['Automation', 'Respond.io', ['respond\\.io'], 10],
  ['Automation', 'WhatsApp', ['whatsapp'], 7],
  ['Automation', 'Webhooks / APIs', ['webhooks?', 'api integrations?', 'integrations?'], 5],
  ['Automation', 'Automation', ['automation', 'automate', 'workflows?'], 6],
  ['AI', 'AI / LLMs', ['\\bai\\b', 'artificial intelligence', 'chatgpt', '\\bllms?\\b', '\\bclaude\\b', 'openai', '\\bgpt', 'ai agents?', 'chatbots?', 'prompt engineering', 'agentic'], 7],
  ['Web', 'WordPress', ['wordpress', '\\bwp\\b'], 8],
  ['Web', 'Elementor', ['elementor'], 8],
  ['Web', 'Shopify', ['shopify'], 9],
  ['Web', 'Squarespace / Wix / Webflow', ['squarespace', '\\bwix\\b', 'webflow'], 5],
  ['Web', 'Landing pages', ['landing pages?'], 6],
  ['Web', 'Vercel', ['vercel'], 5],
  ['Web', 'No-code', ['no-?code', 'low-?code'], 5],
  ['Marketing', 'Klaviyo', ['klaviyo'], 9],
  ['Marketing', 'Meta Ads', ['meta ads', 'facebook ads', 'ads manager', 'instagram ads', 'paid social'], 7],
  ['Marketing', 'Google Business Profile', ['google business profile', 'google my business', '\\bgbp\\b', '\\bgmb\\b'], 8],
  ['Marketing', 'Email marketing', ['email marketing', 'mailchimp', 'email campaigns?'], 5],
  ['Marketing', 'Marketing ops', ['marketing operations', 'marketing ops', 'martech'], 6],
  ['Marketing', 'LinkedIn / profiles', ['linkedin profile', 'personal brand'], 4],
  ['Data', 'Excel', ['\\bexcel\\b'], 6],
  ['Data', 'Google Sheets', ['google sheets', 'spreadsheets?'], 7],
  ['Data', 'Dashboards / reporting', ['dashboards?', 'reporting', 'looker studio'], 5],
  ['Ops', 'Monday.com', ['monday\\.com'], 8],
  ['Ops', 'Airtable / Notion / ClickUp', ['airtable', 'notion', 'clickup', 'asana', 'trello'], 4],
  ['Ops', 'Microsoft 365 / SharePoint', ['microsoft 365', 'office 365', '\\bm365\\b', '\\bo365\\b', 'sharepoint', 'microsoft forms'], 7],
  ['Ops', 'Google Workspace', ['google workspace', 'g ?suite'], 5],
  ['Ops', 'Virtual assistant', ['virtual assistant', 'executive assistant', 'admin(istrative)? assistant', 'personal assistant', 'remote assistant'], 8],
  ['Ops', 'Operations support', ['operations (coordinator|assistant|specialist|support|associate)', 'process (mapping|improvement|automation)', '\\bsops?\\b', 'standard operating procedures'], 6],
  ['Ops', 'Minutes / transcription', ['meeting minutes', 'transcription', 'minutes of meeting'], 4],
  ['Ops', 'Canva / presentations', ['canva', 'pitch decks?', 'powerpoint'], 3],
];

// Titles that are almost never a fit: the score is cut hard when one of these is in the title.
export const TITLE_NEGATIVES = [
  '\\b(backend|back-end|frontend|front-end|full[- ]?stack|software|devops|site reliability|sre|data|ml|machine learning|security|embedded|firmware|mobile|ios|android|qa|test|platform|infrastructure|cloud|network|hardware|game)\\s+(engineer|developer|scientist|architect)',
  '\\b(staff|principal|founding|product|ai|ml|llm|research) engineer',
  '\\bengineer(ing)?,\\s*(infrastructure|security|database|platform|backend|frontend|data|ml|site|reliability|cloud)',
  '\\b(security|database|reliability|infrastructure) engineer',
  '\\b(nurse|physician|therapist|clinical|clinician|attorney|lawyer|paralegal|cpa|auditor|teacher|tutor|driver|technician|pharmac\\w*|dental|medical|psychologist|counselor|caregiver|adjuster|underwriter)\\b',
  '\\b(account executive|sales development|business development representative|sdr|bdr|recruiter|talent acquisition|closer|cold caller|appointment setter)\\b',
];

// Location text that means you can take the job from the Philippines.
export const LOCATION_OK = '(worldwide|anywhere|global|international|apac|asia|philippines|\\bph\\b|australia|\\bau\\b|new zealand|singapore|uae|dubai|middle east|remote\\s*$|^remote$|no restriction)';
// Location text that means the role is restricted somewhere else.
export const LOCATION_RESTRICTED = '(\\bus\\b|\\busa\\b|u\\.s\\.|united states|canada|north america|\\buk\\b|united kingdom|europe|\\beu\\b|emea|germany|france|spain|netherlands|poland|latam|latin america|brazil|mexico|argentina|india|onsite|on-site|in-office|hybrid)';
