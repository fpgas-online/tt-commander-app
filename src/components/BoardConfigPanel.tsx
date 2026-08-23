import {
  Error,
  FactCheck,
  Info,
  PrecisionManufacturing,
  Save,
  Warning,
} from '@suid/icons-material';
import {
  Alert,
  Button,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@suid/material';
import { createSignal, For, Show } from 'solid-js';
import { boardInfo } from '~/model/board';
import { deviceState, selectedDesignAddress, updateDeviceState } from '~/model/DeviceState';
import { isFactoryMode } from '~/model/factory';
import { safeCompareVersions, subtileFirmwareVersion } from '~/model/firmware';
import { fpgaDesigns, loadFpgaDesigns } from '~/model/fpgaDesigns';
import {
  DesignAddress,
  findProject,
  formatDesignAddress,
  Project,
  projectAddress,
  shuttle,
} from '~/model/shuttle';
import { frequencyTable, TTBoardDevice } from '~/ttcontrol/TTBoardDevice';
import { GitHubIcon } from './GitHubIcon';
import { LoadingButton } from './LoadingButton';
import { ProjectSelect } from './ProjectSelect';

export interface IBoardConfigPanelProps {
  device: TTBoardDevice;
}

export function BoardConfigPanel(props: IBoardConfigPanelProps) {
  /** FPGA boards have no mux index and no subtiles: the daemon loads designs by name. */
  const isFpga = () => boardInfo.kind === 'fpga';

  const maxClockFreq = () =>
    safeCompareVersions(props.device.data.version ?? '0.0.0', '2.0.4') >= 0
      ? 100_000_000
      : 66_500_000;
  const setClock = () => {
    void props.device.setClock(deviceState.clockHz);
  };

  // Loading a design on an FPGA board is a multi-second daemon round trip, not
  // a REPL write: hold the button until it lands so it can't be fired twice.
  const [selecting, setSelecting] = createSignal(false);
  const selectDesign = () => {
    if (deviceState.uiIn.length > 0) {
      void props.device.writeUIIn(0);
      updateDeviceState({ uiIn: [] });
    }
    setSelecting(true);
    void props.device
      .selectDesign(selectedDesignAddress(), selectedProject()?.clock_hz)
      .finally(() => setSelecting(false));
  };

  /** Re-runs GET /designs after the daemon failed to answer it. */
  const retryLoadDesigns = () => {
    const apiBase = boardInfo.apiBase;
    if (apiBase) {
      void loadFpgaDesigns(apiBase);
    }
  };

  const selectedProject = () => findProject(shuttle.projects, selectedDesignAddress());

  const dangerLevel = () => selectedProject()?.danger_level;
  const dangerReason = () => selectedProject()?.danger_reason;

  const subtileSelected = () => deviceState.selectedSubtile != null;
  const subtileUnsupported = () =>
    subtileSelected() &&
    safeCompareVersions(props.device.data.version ?? '0.0.0', subtileFirmwareVersion) < 0;

  const selectDisabledReason = () =>
    subtileUnsupported()
      ? `Subtile projects require firmware ${subtileFirmwareVersion} or newer`
      : dangerReason();

  const setSelectedAddress = (design: DesignAddress) => {
    updateDeviceState({ selectedDesign: design.address, selectedSubtile: design.subtile });
    const project = findProject(shuttle.projects, design);
    if (project?.clock_hz) {
      updateDeviceState({ clockHz: project.clock_hz });
    }
  };

  const setSelectedProject = (project: Project) => {
    setSelectedAddress(projectAddress(project));
  };

  const setSelectedIndex = (address: number) => {
    if (Number.isNaN(address)) {
      return;
    }
    // A group tile can't be enabled on its own, so its address selects the first subtile in it.
    const subtiles = shuttle.projects.filter((p) => p.type === 'subtile' && p.address === address);
    const subtile = subtiles.length ? Math.min(...subtiles.map((p) => p.subtile_addr ?? 0)) : null;
    setSelectedAddress({ address, subtile });
  };

  const writeConfigIni = () => {
    void props.device.writeConfig(
      selectedProject()?.macro ?? formatDesignAddress(selectedDesignAddress()),
      deviceState.clockHz,
    );
  };

  const projectLinks = () => {
    const project = selectedProject();
    if (!project) {
      return null;
    }
    if (isFpga()) {
      // An FPGA design is not a shuttle project: it has no tinytapeout.com chip
      // page and no feedback form, only the URLs the daemon reports (either of
      // which may be empty, e.g. for an upload).
      const design = fpgaDesigns.byName[project.macro];
      return { repo: design?.repo_url ?? '', docs: design?.docs_url ?? '', feedback: '' };
    }
    return {
      repo: `${project.repo}/tree/${project.commit}`,
      docs: `https://tinytapeout.com/chips/${shuttle.id}/${project.macro}`,
      feedback: `https://app.tinytapeout.com/shuttles/${shuttle.id}/${project.macro}/feedback`,
    };
  };

  /** The links row, or null when this design has no links worth a row. */
  const anyProjectLink = () => {
    const links = projectLinks();
    return links && (links.repo || links.docs || links.feedback) ? links : null;
  };

  return (
    <>
      <Stack direction="row" spacing={1} marginTop={2} marginBottom={2}>
        <FormControl sx={{ width: 300 }}>
          <Show when={!shuttle.loading}>
            <ProjectSelect
              projects={shuttle.projects}
              selected={selectedProject()}
              onSelect={setSelectedProject}
            />
          </Show>
          <Show when={shuttle.loading}>
            <InputLabel id="project-select-label">Project</InputLabel>
            <Select
              labelId="project-select-label"
              label="Project"
              type="number"
              size="small"
              value={0}
              fullWidth
              disabled
            >
              <MenuItem value={0}>Loading projects...</MenuItem>
            </Select>
          </Show>
        </FormControl>

        <Show when={!isFpga()}>
          <TextField
            sx={{ maxWidth: 80 }}
            label="Index"
            type="number"
            size="small"
            value={deviceState.selectedDesign}
            InputProps={{ inputProps: { min: 0, max: 1023 } }}
            fullWidth
            onChange={(e) => setSelectedIndex((e.target as HTMLInputElement).valueAsNumber)}
          />
        </Show>
        <Show when={subtileSelected() && !isFpga()}>
          <TextField
            sx={{ maxWidth: 80 }}
            label="Subtile"
            size="small"
            value={deviceState.selectedSubtile}
            title="Index of the project within its group tile"
            InputProps={{ readOnly: true }}
            fullWidth
          />
        </Show>
        <LoadingButton
          onClick={selectDesign}
          loading={selecting()}
          variant="contained"
          disabled={dangerLevel() === 'high' || subtileUnsupported()}
          title={selectDisabledReason()}
        >
          {isFpga() ? 'Load design' : 'Select'}
        </LoadingButton>
        <Show when={subtileUnsupported() && dangerLevel() !== 'high'}>
          <span title={selectDisabledReason()}>
            <Error color="error" fontSize="large" sx={{ marginLeft: 0.5 }} />
          </span>
        </Show>
        <Show when={dangerLevel() === 'medium'}>
          <span title={dangerReason()}>
            <Warning color="warning" fontSize="large" sx={{ marginLeft: 0.5 }} />
          </span>
        </Show>
        <Show when={dangerLevel() === 'high'}>
          <span title={dangerReason()}>
            <Error color="error" fontSize="large" sx={{ marginLeft: 0.5 }} />
          </span>
        </Show>
      </Stack>

      <Show when={isFpga() && fpgaDesigns.error}>
        {(message) => (
          <Alert
            severity="error"
            sx={{ marginBottom: 2 }}
            action={
              <Button color="inherit" size="small" onClick={retryLoadDesigns}>
                Retry
              </Button>
            }
          >
            Could not load the design list: {message()}
          </Alert>
        )}
      </Show>

      <Show when={props.device.data.designError}>
        {(message) => (
          <Alert
            severity="error"
            sx={{ marginBottom: 2 }}
            onClose={() => props.device.clearDesignError()}
          >
            {message()}
          </Alert>
        )}
      </Show>

      <Stack direction="row" spacing={1} marginBottom={1}>
        <TextField
          sx={{ maxWidth: 132 }}
          label="Clock speed (Hz)"
          type="number"
          size="small"
          value={deviceState.clockHz}
          InputProps={{ inputProps: { min: 0, max: maxClockFreq() } }}
          fullWidth
          onChange={(e) =>
            updateDeviceState({ clockHz: (e.target as HTMLInputElement).valueAsNumber })
          }
        />

        <FormControl sx={{ width: 120 }}>
          <InputLabel id="frequency-select-label">Preset</InputLabel>

          <Select
            labelId="frequency-select-label"
            label="Preset"
            type="number"
            size="small"
            value={deviceState.clockHz}
            fullWidth
            onChange={(e) => e.target.value && updateDeviceState({ clockHz: e.target.value })}
          >
            <For each={frequencyTable.filter((item) => parseInt(item.value, 10) <= maxClockFreq())}>
              {(freq) => <MenuItem value={freq.value}>{freq.title}</MenuItem>}
            </For>
          </Select>
        </FormControl>

        <Button onClick={setClock} variant="contained">
          Set
        </Button>
      </Stack>

      <Stack my={1} direction="row" spacing={1}>
        <Show when={false}>
          <Button onClick={writeConfigIni} variant="contained" startIcon={<Save />}>
            Persist config to board
          </Button>
        </Show>

        <Show when={isFactoryMode()}>
          <Button
            sx={{ backgroundColor: 'orange' }}
            onClick={() => props.device.factorySetup()}
            variant="outlined"
            startIcon={<PrecisionManufacturing />}
          >
            Factory Test
          </Button>
          <Show when={props.device.data.factoryTest.status !== 'idle'}>
            <Chip
              label={
                props.device.data.factoryTest.status === 'running'
                  ? 'Running...'
                  : props.device.data.factoryTest.status === 'pass'
                    ? 'PASS'
                    : 'FAIL'
              }
              title={props.device.data.factoryTest.message}
              sx={{
                fontWeight: 'bold',
                color: '#fff',
                backgroundColor:
                  props.device.data.factoryTest.status === 'running'
                    ? '#9e9e9e'
                    : props.device.data.factoryTest.status === 'pass'
                      ? '#2e7d32'
                      : '#c62828',
              }}
            />
          </Show>
        </Show>
      </Stack>

      <Show when={anyProjectLink()}>
        {(projectLinks) => (
          <Stack my={1} direction="row" spacing={1}>
            <Show when={projectLinks().feedback}>
              <Button
                component="a"
                sx={{ backgroundColor: 'yellow' }}
                href={projectLinks().feedback}
                target="_blank"
                variant="outlined"
                startIcon={<FactCheck />}
              >
                Report results
              </Button>
            </Show>
            <Show when={projectLinks().docs}>
              <Button component="a" startIcon={<Info />} href={projectLinks().docs} target="_blank">
                Project docs
              </Button>
            </Show>
            <Show when={projectLinks().repo}>
              <Button
                component="a"
                startIcon={<GitHubIcon />}
                href={projectLinks().repo}
                target="_blank"
              >
                Repo
              </Button>
            </Show>
          </Stack>
        )}
      </Show>
    </>
  );
}
