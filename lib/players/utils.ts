/** Pure age calculation — extracted from lineup page so components can import it. */
export function calcAge(born: string): number {
  const today = new Date();
  const b     = new Date(born);
  let age = today.getFullYear() - b.getFullYear();
  const m = today.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--;
  return age;
}
