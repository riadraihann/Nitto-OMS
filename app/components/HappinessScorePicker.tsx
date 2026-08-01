"use client";

import { HAPPINESS_SCORE_OPTIONS, HAPPINESS_EMOJIS, HAPPINESS_LABELS } from '@/lib/theme';

type HappinessScorePickerProps = {
  value: number | null;
  onChange: (value: number) => void;
  disabled?: boolean;
};

// Row of 5 emoji buttons, 1 (angry) through 5 (loved it), left to right. The selected one gets
// a visible border/scale/highlight -- not just a subtler numeric indicator -- since that's the
// whole point of replacing the old freeform decimal number input.
export default function HappinessScorePicker({ value, onChange, disabled }: HappinessScorePickerProps) {
  return (
    <div className="happiness-picker" role="radiogroup" aria-label="Happiness score">
      {HAPPINESS_SCORE_OPTIONS.map((score) => (
        <button
          key={score}
          type="button"
          role="radio"
          aria-checked={value === score}
          aria-label={`${score} - ${HAPPINESS_LABELS[score]}`}
          title={HAPPINESS_LABELS[score]}
          disabled={disabled}
          className={`happiness-picker-option${value === score ? ' selected' : ''}`}
          onClick={() => onChange(score)}
        >
          {HAPPINESS_EMOJIS[score]}
        </button>
      ))}
    </div>
  );
}
