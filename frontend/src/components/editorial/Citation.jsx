import React from 'react';

export default function Citation({ sanskrit, english, source }) {
  return (
    <div className="k-citation">
      {/* lang="sa" is correct HERE and only here: this slot carries the Gītā
          verses, which are genuine Sanskrit, unlike the `sanskrit` prop on
          PageHeader. */}
      {sanskrit && <div className="k-citation__sans" lang="sa">{sanskrit}</div>}
      <div className="k-citation__src">
        — {source}{english && <> · <em>{english}</em></>}
      </div>
    </div>
  );
}
