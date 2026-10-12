/** The spellings to try when matching a typed name to a canonical one: as typed, then singular. */
export function nameForms(name: string) {
  const folded = name.trim().toLowerCase().replace(/\s+/g, " ");
  const forms = [folded];
  if (folded.endsWith("ies")) forms.push(`${folded.slice(0, -3)}y`);
  if (folded.endsWith("oes")) forms.push(folded.slice(0, -2));
  if (folded.endsWith("es")) forms.push(folded.slice(0, -2));
  if (folded.endsWith("s")) forms.push(folded.slice(0, -1));
  return forms;
}
