import React from 'react';

export function Input({ value, onChange, placeholder, type = 'text', style, className = '' }) {
  return (
    <input
      className={'k-input ' + className}
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      style={style}
    />
  );
}
