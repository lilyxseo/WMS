import { displayText } from './menu.js';

export function renderWelcome(profile, now = new Date(), timeZone = 'Asia/Jakarta') {
  let hour;
  try {
    hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
  } catch {
    hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', hourCycle: 'h23' }).format(now));
  }
  const greeting = hour >= 5 && hour < 11 ? 'pagi' : hour >= 11 && hour < 15 ? 'siang' : hour >= 15 && hour < 18 ? 'sore' : 'malam';
  if (!profile) return `👋 *Selamat ${greeting}!*\nSelamat datang di *Bot WMS*.\nNama dan role belum tersedia dari profil nomor WhatsApp.`;
  const name = displayText(String(profile.full_name || '').trim() || profile.username || 'Pengguna');
  const role = displayText(String(profile.role || '').trim() || 'Belum diatur');
  return `👋 *Selamat ${greeting}, ${name}!*\nSelamat datang di *Bot WMS*.\nRole: *${role}*`;
}
