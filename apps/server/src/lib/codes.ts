export function generateSixDigitCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}
