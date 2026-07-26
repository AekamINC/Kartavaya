import React from 'react';

export default class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center', maxWidth: 480, margin: '0 auto' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px', fontFamily: 'var(--font-display)' }}>
          Something went wrong
        </h2>
        {/* 24-bilingual-devanagari.md, "Where Devanagari appears — and where it
            must not": error text is on the No list. The rule is that Devanagari
            is a recognition cue on things the user already knows the meaning of;
            someone reading an error for the first time is not helped by half of
            it being in a script they may not read, and a bilingual error is
            longer and harder to scan at the moment they are least patient. */}
        <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 20 }}>
          {this.state.error?.message || 'An unexpected error occurred.'}
        </p>
        <button className="k-btn k-btn--primary" onClick={() => { this.setState({ error: null }); window.location.reload(); }}>
          Reload page
        </button>
      </div>
    );
  }
}
