export const is_mac =
	typeof navigator !== 'undefined' &&
	/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** The platform's primary modifier: ⌘ on Apple devices, Ctrl elsewhere. */
export const MOD = is_mac ? '⌘' : 'Ctrl';
export const ALT = is_mac ? '⌥' : 'Alt';

export function has_mod(event: KeyboardEvent | MouseEvent) {
	return is_mac ? event.metaKey : event.ctrlKey;
}

/** Whether a key press would type a character, i.e. should start editing a day. */
export function is_printable(event: KeyboardEvent) {
	return event.key.length === 1 && !event.ctrlKey && !event.metaKey;
}

export function is_text_field(target: EventTarget | null) {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
	);
}

export type ShortcutGroup = { title: string; shortcuts: { keys: string[][]; label: string }[] };

export const SHORTCUTS: ShortcutGroup[] = [
	{
		title: 'Move',
		shortcuts: [
			{ keys: [['↑'], ['↓']], label: 'Previous / next day' },
			{ keys: [['←'], ['→']], label: 'Same day in previous / next month' },
			{ keys: [['Home'], ['End']], label: 'First / last day of the month' },
			{
				keys: [
					[MOD, 'Home'],
					[MOD, 'End']
				],
				label: 'First / last day of the year'
			},
			{ keys: [['Page Up'], ['Page Down']], label: 'Previous / next year' },
			{ keys: [[MOD, 'K']], label: 'Search, go to a date, run a command or quick-add' }
		]
	},
	{
		title: 'Select',
		shortcuts: [
			{ keys: [['Shift', '↑ ↓ ← →']], label: 'Select a range of days' },
			{ keys: [['Shift', 'Home / End']], label: 'Select to start / end of month' },
			{ keys: [['Esc']], label: 'Collapse the selection' }
		]
	},
	{
		title: 'Edit',
		shortcuts: [
			{ keys: [['Any letter']], label: 'Start typing a new title' },
			{ keys: [['Enter'], ['F2']], label: 'Edit the title' },
			{ keys: [['Shift', 'Enter']], label: 'Edit details (description, color)' },
			{ keys: [['Enter'], ['Tab']], label: 'While editing: save and move down / right' },
			{ keys: [['Esc']], label: 'While editing: cancel' },
			{ keys: [[ALT, '1–6']], label: 'Set color' },
			{ keys: [[ALT, '0']], label: 'Remove color' },
			{ keys: [[ALT, 'Shift', '1–6']], label: 'Highlight a category (Esc clears)' },
			{ keys: [[ALT, '↑ ↓']], label: 'Move the event a day earlier / later' },
			{ keys: [[ALT, '← →']], label: 'Move the event a week earlier / later' },
			{ keys: [[ALT, 'Shift', '↑ ↓ ← →']], label: 'Shorten / lengthen the event' },
			{ keys: [['Delete'], ['Backspace']], label: 'Clear' },
			{
				keys: [
					[MOD, 'C'],
					[MOD, 'X'],
					[MOD, 'V']
				],
				label: 'Copy / cut / paste'
			},
			{
				keys: [
					[MOD, 'Z'],
					[MOD, 'Shift', 'Z']
				],
				label: 'Undo / redo'
			}
		]
	},
	{
		title: 'Help',
		shortcuts: [{ keys: [[MOD, '/']], label: 'Show keyboard shortcuts' }]
	}
];
