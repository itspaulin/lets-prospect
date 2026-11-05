export const addBusinessDays = (isoDate: string, days: number): string => {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  let remaining = days;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining--;
  }
  return date.toISOString().slice(0, 10);
};
