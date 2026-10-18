import React from 'react';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { EmptyState, EmptyStateBody } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import CubeIcon from "@patternfly/react-icons/dist/esm/icons/cube-icon.js";
import SyncIcon from "@patternfly/react-icons/dist/esm/icons/sync-icon.js";
import cockpit from 'cockpit';

import type { SystemOverview } from '../types';

const _ = cockpit.gettext;

// PLACEHOLDER: a later task replaces this file with the real datasets view.
// Keep the exported signature stable.
export function DatasetsPage({ overview, refresh }: { overview: SystemOverview; refresh: () => void }) {
    return (
        <EmptyState icon={CubeIcon} titleText={_("Datasets view coming soon")} headingLevel="h2">
            <EmptyStateBody>
                {cockpit.format(_("$0 datasets discovered."), overview.datasets.length)}
            </EmptyStateBody>
            <Button variant="secondary" icon={<SyncIcon />} onClick={refresh}>
                {_("Refresh")}
            </Button>
        </EmptyState>
    );
}
