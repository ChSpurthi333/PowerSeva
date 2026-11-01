// Shared input rules used by the auth and admin controllers
const GMAIL_RE = /^[a-z0-9._%+-]+@gmail\.com$/i;
const PHONE_RE = /^[0-9+\-\s]{10,15}$/;
const GMAIL_MESSAGE = 'Enter a valid Gmail address (example@gmail.com)';

module.exports = { GMAIL_RE, PHONE_RE, GMAIL_MESSAGE };
