// Pahchan · पहचान — attendance route shell.
//
// Spec: design-handover/07-pahchan.md. v1 is login + live selfie + GPS, verified
// by HUMAN COMPARISON against two reference photos captured at enrollment. Face
// matching is parked to v2 and device enrollment is dropped.
//
// The Register tab is first on purpose. §3 calls it "the surface that decides
// whether this works" — human comparison is the only verification, so if the
// reviewer cannot keep up the feature is theatre. Policy and enrollment support
// it; they are not the point of the page.
import React, { useState } from 'react';
import { PageHeader, TabBar } from '../components/editorial';
import Register from './pahchan/Register';
import EnrollQueue from './pahchan/EnrollQueue';
import PahchanPolicy from './pahchan/PahchanPolicy';

const TABS = ['register', 'enrollment', 'policy'];

export default function PahchanPage() {
  const [tab, setTab] = useState('register');
  return (
    <div style={{ padding: '0 0 48px' }}>
      <PageHeader
        title="Pahchan"
        sanskrit="पहचान"
        lede="Attendance — clock-ins are recorded on the phone and confirmed here by comparing the selfie against two reference photos."
      />
      <TabBar tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'register' && <Register />}
      {tab === 'enrollment' && <EnrollQueue />}
      {tab === 'policy' && <PahchanPolicy />}
    </div>
  );
}
