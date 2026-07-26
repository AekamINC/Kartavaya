import React from 'react';
import StatusField   from './StatusField';
import PersonField   from './PersonField';
import DateField     from './DateField';
import NumberField   from './NumberField';
import DropdownField from './DropdownField';
import TextField     from './TextField';
import FilesField    from './FilesField';

export default function FieldRenderer({ field, value, onChange, readOnly = false }) {
  const props = { field, value, onChange, readOnly };
  switch (field.type) {
    case 'status':   return <StatusField   {...props} />;
    case 'person':   return <PersonField   {...props} />;
    case 'date':     return <DateField     {...props} />;
    case 'number':   return <NumberField   {...props} />;
    case 'dropdown': return <DropdownField {...props} />;
    case 'text':     return <TextField     {...props} />;
    case 'files':    return <FilesField    {...props} />;
    default:
      // Named, not silent. A custom field whose type the client does not know
      // renders as its type rather than as nothing, so the mismatch is visible
      // to the person who can fix it instead of looking like missing data.
      return <span className="fld__hint">Unknown field type: {field.type}</span>;
  }
}
