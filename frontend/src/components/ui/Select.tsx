'use client';

import { Fragment, ReactNode } from 'react';
import { Listbox, Transition } from '@headlessui/react';
import { cn } from '@/lib/utils';

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  error?: boolean;
  className?: string;
}

export function Select({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  error,
  className,
  ...props
}: SelectProps) {
  const selectedOption = options.find(opt => opt.value === value);

  return (
    <Listbox value={value} onChange={onChange}>
      <div className={cn('relative', className)} {...props}>
        <Listbox.Button
          className={cn(
            'input-field text-left flex items-center justify-between',
            error && 'input-field-error'
          )}
        >
          <span className={!selectedOption ? 'text-feather-white/40' : ''}>
            {selectedOption?.label ?? placeholder}
          </span>
          <ChevronDownIcon className="w-4 h-4 text-feather-white/40" />
        </Listbox.Button>

        <Transition
          as={Fragment}
          enter="transition ease-out duration-100"
          enterFrom="opacity-0 scale-95"
          enterTo="opacity-100 scale-100"
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100 scale-100"
          leaveTo="opacity-0 scale-95"
        >
          <Listbox.Options className="absolute z-50 mt-1 w-full origin-top bg-ash-gray border border-carbon-gray rounded-lg shadow-lg max-h-60 overflow-auto py-1">
            {options.length === 0 ? (
              <div className="py-2 px-4 text-feather-white/40 text-sm">
                No options available
              </div>
            ) : (
              options.map(option => (
                <Listbox.Option
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className={({ active, selected }) =>
                    cn(
                      'relative cursor-pointer select-none py-2 px-4',
                      active && 'bg-carbon-gray',
                      selected && 'text-phoenix-ember',
                      option.disabled && 'opacity-50 cursor-not-allowed'
                    )
                  }
                >
                  {option.label}
                </Listbox.Option>
              ))
            )}
          </Listbox.Options>
        </Transition>
      </div>
    </Listbox>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}
