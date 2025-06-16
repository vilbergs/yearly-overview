<script lang="ts">
	const year = new Date().getFullYear();
	const is_leap_year = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const days_in_year = is_leap_year ? 366 : 365;

	let dialog: HTMLDialogElement | null = null;
	let editing_cell_data = $state<{ title: string; description: string }>({
		title: '',
		description: ''
	});
	let highlighted_item_element_rect = $state<DOMRect | null>(null);
	let selected_day = $state<number>(-1);

	const months = [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December'
	];

	const day_labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

	const month_color = [
		'#FF5733', // January
		'#33FF57', // February
		'#3357FF', // March
		'#FF33A1', // April
		'#A133FF', // May
		'#33FFF5', // June
		'#F5FF33', // July
		'#FF8333', // August
		'#33FF83', // September
		'#8333FF', // October
		'#FF3383', // November
		'#3383FF' // December
	];

	const days = Array.from({ length: days_in_year }, (_, i) => getMonthDayFromDayOfYear(i + 1));
	const data = $state<Record<number, { title: string; description: string }>>({});

	function getMonthDayFromDayOfYear(dayOfYear: number) {
		const date = new Date(year, 0, dayOfYear); // January 1st of the current year

		return {
			month: date.getMonth() + 1,
			day: date.getDate(),
			date: date,
			isWeekend: date.getDay() === 0 || date.getDay() === 6 // 0 = Sunday, 6 = Saturday
		};
	}

	function save_cell_data(day_index: number) {
		editing_cell_data.title = editing_cell_data.title.trim();
		editing_cell_data.description = editing_cell_data.description.trim();

		data[day_index] = editing_cell_data;

		selected_day = -1; // Close dialog after saving
	}
</script>

<div class="grid">
	{#each months as month, index}
		<div
			class="month-header"
			style="grid-column: {index + 1}; grid-row: 1; background-color: {month_color[index]};"
		>
			{month}
		</div>
	{/each}

	{#each days as { month, day, date, isWeekend }, day_index}
		<button
			class="day"
			style="grid-column: {month}; grid-row: {day + 1};"
			style:background-color={isWeekend ? '#f0f0f0' : '#fff'}
			data-day-index={day_index}
			onclick={(event) => {
				if (!event.target) {
					return;
				}

				const target = (event.target as HTMLElement).closest('button');

				if (!target) {
					return;
				}

				highlighted_item_element_rect = target.getBoundingClientRect();
			}}
			ondblclick={(event) => {
				selected_day = day_index;
			}}
			onfocus={(event) => {
				if (!event.target) {
					return;
				}

				const target = (event.target as HTMLElement).closest('button');

				if (!target) {
					return;
				}

				highlighted_item_element_rect = target.getBoundingClientRect();
			}}
		>
			<div class="day-content">
				<span class="day-number">{day}.</span>
				<div class="day-title">
					{#if data[day_index]}
						{data[day_index].title}
					{:else}
						{day_labels[date.getDay()]}
					{/if}
				</div>
			</div>
		</button>
	{/each}

	<div
		class="focus-ring"
		style:display={highlighted_item_element_rect ? 'block' : 'none'}
		style:width={highlighted_item_element_rect?.width + 'px'}
		style:height={highlighted_item_element_rect?.height + 'px'}
		style:transform={`translate(${highlighted_item_element_rect?.left}px, ${highlighted_item_element_rect?.top}px)`}
	></div>

	<dialog
		class="cell-dialog"
		open={selected_day !== -1}
		style:top={highlighted_item_element_rect?.top + 'px'}
		style:left={highlighted_item_element_rect?.right + 'px'}
		onclose={() => {
			selected_day = -1; // Close dialog on outside click
		}}
		onkeydown={(event) => {
			if (event.key === 'Enter') {
				save_cell_data(selected_day);

				selected_day = -1; // Close dialog on Enter
			}
		}}
	>
		<div class="cell-dialog-content">
			<input type="text" bind:value={editing_cell_data.title} style="width: 100%;" />
			<textarea
				bind:value={editing_cell_data.description}
				placeholder="Description (optional)"
				rows="3"
				style="width: 100%;"
			></textarea>
			<button
				onclick={() => {
					save_cell_data(selected_day);
					editing_cell_data = { title: '', description: '' }; // Reset after saving
				}}>Save</button
			>
			<button onclick={() => (selected_day = -1)}>Close</button>
		</div>
	</dialog>
</div>

<style>
	.grid {
		display: grid;
		font-size: 14px;
		grid-template-columns: repeat(12, 1fr);
		grid-template-rows: repeat(31, 1fr); /* Max days in any month */
		height: 100vh; /* Or your desired height */

		background-color: #bbb;
	}

	.day,
	.month-header {
		display: flex;
		align-items: center;
		padding: 4px;
	}

	.month-header {
		font-weight: 600;
		border-right: 1px solid transparent;
		border-bottom: 1px solid #ddd;
	}

	.day {
		border-bottom: 1px solid #ddd;
		border-right: 1px solid #ddd;
		overflow: hidden;

		& .day-content {
			display: flex;
			width: 100%;
			height: 100%;
			cursor: pointer;
			align-items: center;
			gap: 2px;
		}

		& .day-number {
			font-weight: 600;
			color: var(--gray-500);
		}

		& .day-title {
			text-align: left;
			flex-grow: 1;
			color: var(--gray-900);
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		&:focus-visible,
		&:focus {
			outline: none; /* Remove default focus outline */
		}
	}

	.focus-ring {
		position: absolute;
		border: 2px solid #007bff;
		border-radius: 2px;
		pointer-events: none; /* Prevent interaction */
		width: 100px; /* Adjust as needed */
		height: 100px; /* Adjust as needed */
	}

	.cell-dialog {
		border: 1px solid #ccc;
		background-color: white;
		padding: 24px;
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
		margin-left: 4px;

		border-radius: 8px;
	}

	.cell-dialog-content {
		display: flex;
		flex-direction: column;
		gap: 8px;
		align-items: start;
	}
</style>
