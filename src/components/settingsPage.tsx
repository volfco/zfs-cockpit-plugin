import React from 'react';
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import {
    DataList, DataListItem, DataListItemRow, DataListItemCells,
    DataListCell, DataListAction,
} from "@patternfly/react-core/dist/esm/components/DataList/index.js";
import PencilAltIcon from "@patternfly/react-icons/dist/esm/icons/pencil-alt-icon.js";
import cockpit from 'cockpit';

import { FormDialog, type FieldDef, type FormValues } from './dialogs';
import * as svc from '../service';

const _ = cockpit.gettext;

// ---------------------------------------------------------------------------
// App settings store — the few preferences the app actually reads. Persisted
// in localStorage; logDiscovery mirrors svc.setLogDiscovery so the command log
// toggle and the Settings row stay in sync.
// ---------------------------------------------------------------------------

export interface AppSettings {
    logDiscovery: boolean;
    importSearchDir: string;
    confirmDestructive: boolean;
}

const STORAGE_KEY = 'zfs-cockpit-settings';

function loadSettings(): AppSettings {
    const defaults: AppSettings = {
        logDiscovery: false,
        importSearchDir: '',
        confirmDestructive: true,
    };
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<AppSettings>) };
    } catch {
        // Unparsable/absent storage falls back to defaults.
    }
    return defaults;
}

let settings: AppSettings = loadSettings();

// Apply the persisted discovery toggle to the service at module load.
svc.setLogDiscovery(settings.logDiscovery);

export function readSettings(): AppSettings {
    return settings;
}

export function updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    settings = { ...settings, [key]: value };
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
        // Storage may be unavailable (private mode); settings stay in memory.
    }
    if (key === 'logDiscovery') svc.setLogDiscovery(value as boolean);
}

// ---------------------------------------------------------------------------
// Setting model — describes one row on the Settings page (hpssa pattern).
// ---------------------------------------------------------------------------

export interface SettingDef {
    key: keyof AppSettings;
    label: string;
    description: string;
    group: string;
    currentValue: () => string;
    fields: FieldDef[];
    onSave: (values: FormValues) => Promise<string>;
}

export function settingDefs(): SettingDef[] {
    return [
        {
            key: 'logDiscovery',
            group: _("Command log"),
            label: _("Log discovery commands"),
            description: _("Record the read-only zfs/zpool discovery commands (list, get, status) in the command log."),
            currentValue: () => (svc.isLogDiscovery() ? _("On") : _("Off")),
            fields: [{ key: 'on', label: _("Log discovery commands"), type: 'switch', defaultValue: svc.isLogDiscovery() }],
            onSave: v => {
                updateSetting('logDiscovery', Boolean(v.on));
                return Promise.resolve(_("Setting saved."));
            },
        },
        {
            key: 'importSearchDir',
            group: _("Pools"),
            label: _("Import search directory"),
            description: _("Default directory scanned for pool device labels when importing (zpool import -d)."),
            currentValue: () => readSettings().importSearchDir || _("(default search paths)"),
            fields: [{
                key: 'dir',
                label: _("Search directory"),
                type: 'text',
                placeholder: '/dev/disk/by-id',
                defaultValue: readSettings().importSearchDir,
            }],
            onSave: v => {
                updateSetting('importSearchDir', String(v.dir ?? '').trim());
                return Promise.resolve(_("Setting saved."));
            },
        },
        {
            key: 'confirmDestructive',
            group: _("Pools"),
            label: _("Confirm before destructive operations"),
            description: _("Require typing the pool or device name before destroy, export, split, and similar operations. When off, destructive actions run without the typed-name confirmation (immediately when they need no input)."),
            currentValue: () => (readSettings().confirmDestructive ? _("On") : _("Off")),
            fields: [{ key: 'on', label: _("Require typed confirmation"), type: 'switch', defaultValue: readSettings().confirmDestructive }],
            onSave: v => {
                updateSetting('confirmDestructive', Boolean(v.on));
                return Promise.resolve(_("Setting saved."));
            },
        },
    ];
}

// ---------------------------------------------------------------------------
// Settings page — groups rendered as PF DataLists with an edit action each.
// ---------------------------------------------------------------------------

export function SettingsPage({ reload }: { reload: () => void }) {
    const settingsId = React.useId();
    const [editing, setEditing] = React.useState<SettingDef | null>(null);
    const defs = settingDefs();

    // Preserve the order of first appearance for each group.
    const groups: { name: string; items: SettingDef[] }[] = [];
    for (const s of defs) {
        let g = groups.find(x => x.name === s.group);
        if (!g) {
            g = { name: s.group, items: [] };
            groups.push(g);
        }
        g.items.push(s);
    }

    return (
        <Stack hasGutter>
            {groups.map(g => (
                <StackItem key={g.name}>
                    <Card>
                        <CardBody>
                            <Title headingLevel="h3" size="lg" className="pf-v6-u-mb-sm">{g.name}</Title>
                            <DataList aria-label={g.name} isCompact>
                                {g.items.map(s => (
                                    <DataListItem key={s.key} aria-labelledby={`${settingsId}-setting-${s.key}`}>
                                        <DataListItemRow>
                                            <DataListItemCells
                                                dataListCells={[
                                                    <DataListCell key="main">
                                                        <p id={`${settingsId}-setting-${s.key}`} className="pf-v6-u-font-weight-bold">
                                                            {s.label}
                                                        </p>
                                                        <p className="pf-v6-u-color-200 pf-v6-u-font-size-sm pf-v6-u-mt-xs">
                                                            {s.description}
                                                        </p>
                                                    </DataListCell>,
                                                    <DataListCell key="value">
                                                        <span className="zfs-setting-value">
                                                            {s.currentValue()}
                                                        </span>
                                                    </DataListCell>,
                                                ]}
                                            />
                                            <DataListAction
                                                id={`${settingsId}-setting-${s.key}-action`}
                                                aria-labelledby={`${settingsId}-setting-${s.key} ${settingsId}-setting-${s.key}-edit`}
                                                aria-label={cockpit.format(_("Edit $0"), s.label)}
                                            >
                                                <Button
                                                    id={`${settingsId}-setting-${s.key}-edit`}
                                                    variant="secondary"
                                                    size="sm"
                                                    icon={<PencilAltIcon />}
                                                    aria-label={cockpit.format(_("Edit $0"), s.label)}
                                                    onClick={() => setEditing(s)}
                                                >
                                                    {_("Edit")}
                                                </Button>
                                            </DataListAction>
                                        </DataListItemRow>
                                    </DataListItem>
                                ))}
                            </DataList>
                        </CardBody>
                    </Card>
                </StackItem>
            ))}
            {editing && (
                <FormDialog
                    isOpen
                    title={editing.label}
                    description={editing.description}
                    fields={editing.fields}
                    onClose={() => setEditing(null)}
                    // eslint-disable-next-line react/jsx-handler-names
                    onSubmit={editing.onSave}
                    onSuccess={reload}
                />
            )}
        </Stack>
    );
}
