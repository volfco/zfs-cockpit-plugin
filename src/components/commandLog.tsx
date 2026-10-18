import React from 'react';
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { Label } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { EmptyState, EmptyStateBody } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { Card, CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { CodeBlock, CodeBlockCode } from "@patternfly/react-core/dist/esm/components/CodeBlock/index.js";
import { ExpandableSection } from "@patternfly/react-core/dist/esm/components/ExpandableSection/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import TrashIcon from "@patternfly/react-icons/dist/esm/icons/trash-icon.js";
import HistoryIcon from "@patternfly/react-icons/dist/esm/icons/history-icon.js";
import CopyIcon from "@patternfly/react-icons/dist/esm/icons/copy-icon.js";
import DownloadIcon from "@patternfly/react-icons/dist/esm/icons/download-icon.js";
import cockpit from 'cockpit';

import {
    type CommandLogEntry,
    getCommandLog, subscribeCommandLog, clearCommandLog,
    isLogDiscovery, setLogDiscovery,
} from '../service';
import { updateSetting } from './settingsPage';

const _ = cockpit.gettext;

// Quote a single argv element so the rendered command is a copy-pasteable
// shell-safe string. POSIX-shell rules: wrap in single quotes if the arg
// contains anything other than [A-Za-z0-9_:=,./@+%-].
function shellQuote(arg: string): string {
    if (arg === '' || /[^\w:=,./@+%-]/.test(arg)) {
        return `'${arg.replace(/'/g, "'\\''")}'`;
    }
    return arg;
}

function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour12: false });
}

// Render an entry as a bash snippet:
//   # <reason>
//   zpool scrub tank
// entry.args already carries the binary ("zfs"/"zpool") as its first element.
function renderBash(entry: CommandLogEntry): string {
    const cmd = entry.args.map(shellQuote).join(' ');
    return `# ${entry.reason}\n${cmd}`;
}

function statusLabel(entry: CommandLogEntry) {
    if (entry.status === 'pending') return <Label color="blue" isCompact>{_("running")}</Label>;
    if (entry.status === 'error') return <Label color="red" isCompact>{_("failed")}</Label>;
    return <Label color="green" isCompact>{_("ok")}</Label>;
}

function CommandLogEntryView({ entry }: { entry: CommandLogEntry }) {
    const [showOutput, setShowOutput] = React.useState(false);
    const hasOutput = (entry.output && entry.output.trim()) || entry.error;

    return (
        <Card isCompact>
            <CardBody>
                <Flex
                    spaceItems={{ default: 'spaceItemsSm' }}
                    alignItems={{ default: 'alignItemsCenter' }}
                    className="pf-v6-u-mb-xs"
                >
                    <FlexItem>
                        <span className="pf-v6-u-color-200 pf-v6-u-font-size-sm zfs-log-time">
                            {formatTime(entry.timestamp)}
                        </span>
                    </FlexItem>
                    <FlexItem>{statusLabel(entry)}</FlexItem>
                    {entry.durationMs !== undefined && (
                        <FlexItem>
                            <span className="pf-v6-u-color-200 pf-v6-u-font-size-sm">
                                {entry.durationMs} ms
                            </span>
                        </FlexItem>
                    )}
                </Flex>
                <CodeBlock
                    actions={
                        <Button
                            variant="plain"
                            aria-label={_("Copy")}
                            icon={<CopyIcon />}
                            onClick={() => navigator.clipboard?.writeText(renderBash(entry))}
                        />
                    }
                >
                    <CodeBlockCode>{renderBash(entry)}</CodeBlockCode>
                </CodeBlock>
                {hasOutput && (
                    <ExpandableSection
                        toggleText={showOutput ? _("Hide output") : _("Show output")}
                        isExpanded={showOutput}
                        onToggle={(_e, v) => setShowOutput(v)}
                        isIndented
                    >
                        <CodeBlock>
                            <CodeBlockCode>{entry.error || entry.output}</CodeBlockCode>
                        </CodeBlock>
                    </ExpandableSection>
                )}
            </CardBody>
        </Card>
    );
}

export function CommandLog() {
    // Force re-render when log changes; we read directly from the store.
    const [, setVersion] = React.useState(0);
    const [includeDiscovery, setIncludeDiscoveryState] = React.useState(isLogDiscovery());

    React.useEffect(() => subscribeCommandLog(() => setVersion(v => v + 1)), []);

    const log = getCommandLog();
    const sorted = [...log].sort((a, b) => b.timestamp - a.timestamp);

    const downloadScript = () => {
        const header = '#!/usr/bin/env bash\n# zfs/zpool command log exported from ZFS Cockpit\nset -e\n\n';
        const body = [...log]
                .sort((a, b) => a.timestamp - b.timestamp)
                .map(renderBash)
                .join('\n\n');
        const blob = new Blob([header + body + '\n'], { type: 'text/x-shellscript' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `zfs-commands-${new Date().toISOString()
                .slice(0, 19)
                .replace(/[:T]/g, '-')}.sh`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const setDiscovery = (on: boolean) => {
        setLogDiscovery(on);
        updateSetting('logDiscovery', on);
        setIncludeDiscoveryState(on);
    };

    return (
        <Stack hasGutter className="zfs-command-log">
            <StackItem>
                <Flex
                    justifyContent={{ default: 'justifyContentSpaceBetween' }}
                    alignItems={{ default: 'alignItemsCenter' }}
                    flexWrap={{ default: 'wrap' }}
                >
                    <FlexItem>
                        <Title headingLevel="h2" size="xl">{_("Command log")}</Title>
                        <p className="pf-v6-u-color-200 pf-v6-u-font-size-sm pf-v6-u-mt-xs">
                            {cockpit.format(_("$0 entries"), log.length)}
                        </p>
                    </FlexItem>
                    <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }} flexWrap={{ default: 'wrap' }}>
                        <Switch
                            id="zfs-log-include-discovery"
                            label={_("Show discovery commands")}
                            isChecked={includeDiscovery}
                            onChange={(_e, v) => setDiscovery(v)}
                        />
                        <Button
                            variant="secondary"
                            size="sm"
                            icon={<DownloadIcon />}
                            onClick={downloadScript}
                            isDisabled={log.length === 0}
                        >
                            {_("Export as bash script")}
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            icon={<TrashIcon />}
                            onClick={clearCommandLog}
                            isDisabled={log.length === 0}
                        >
                            {_("Clear log")}
                        </Button>
                    </Flex>
                </Flex>
            </StackItem>
            {sorted.length === 0
                ? (
                    <StackItem>
                        <EmptyState icon={HistoryIcon} titleText={_("No commands logged yet")} headingLevel="h3">
                            <EmptyStateBody>
                                {_("Run a pool action or a raw command to see it logged here.")}
                            </EmptyStateBody>
                        </EmptyState>
                    </StackItem>
                )
                : sorted.map(entry => (
                    <StackItem key={entry.id}>
                        <CommandLogEntryView entry={entry} />
                    </StackItem>
                ))}
        </Stack>
    );
}
