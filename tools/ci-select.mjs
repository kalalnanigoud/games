// An omitted selector runs the full suite; unknown/empty selections must never pass silently.
export function selectCases(name, choices, value = process.env[name]) {
  if (value == null || value === '') return [...choices];
  const selected = value.split(',');
  if (selected.some(item => !choices.includes(item)) || new Set(selected).size !== selected.length) {
    throw Error(name + ' must select unique values from: ' + choices.join(', '));
  }
  return selected;
}
