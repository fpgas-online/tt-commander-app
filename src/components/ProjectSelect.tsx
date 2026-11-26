import { Error, Warning } from '@suid/icons-material';
import {
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@suid/material';
import createElementRef from '@suid/system/createElementRef';
import { createSelect, fuzzyHighlight, fuzzySearch } from '@thisbeyond/solid-select';
import { createEffect, createMemo, For, Show } from 'solid-js';
import { fpgaDesigns } from '~/model/fpgaDesigns';
import { fpgaLibrary, PROJECT_LIMIT } from '~/model/fpgaLibrary';
import { formatDesignAddress, Project, projectAddress } from '~/model/shuttle';
import { fuzzySort } from '~/utils/fuzzySort';
import { Popper } from './Popper';

export interface IProjectSelectProps {
  selected?: Project;
  projects: Project[];
  onSelect: (project: Project) => void;
}

export function ProjectListItem(props: { project: Project; search: string }) {
  const trimmedSearch = () => props.search.trim();

  const title = () =>
    trimmedSearch()
      ? fuzzyHighlight(fuzzySearch(trimmedSearch(), props.project.title))
      : props.project.title;

  const author = () =>
    trimmedSearch()
      ? fuzzyHighlight(fuzzySearch(trimmedSearch(), props.project.author))
      : props.project.author;

  return (
    <Stack direction="row" spacing={2} maxWidth={'400px'}>
      <code style={{ 'min-width': '32px', 'text-align': 'right', 'white-space': 'nowrap' }}>
        {formatDesignAddress(projectAddress(props.project))}
      </code>
      <Stack flex={1}>
        <Typography flex={1} minWidth="100%" whiteSpace="pre-wrap">
          {title()}
          <Show when={props.project.danger_level === 'medium'}>
            <span title={props.project.danger_reason}>
              <Warning
                color="warning"
                fontSize="small"
                sx={{ verticalAlign: 'middle', marginLeft: 1 }}
              />
            </span>
          </Show>
          <Show when={props.project.danger_level === 'high'}>
            <span title={props.project.danger_reason}>
              <Error
                color="error"
                fontSize="small"
                sx={{ verticalAlign: 'middle', marginLeft: 1 }}
              />
            </span>
          </Show>
        </Typography>
        <Typography
          variant="body2"
          color="textSecondary"
          title={props.project.author}
          overflow="hidden"
          whiteSpace="nowrap"
          textOverflow="ellipsis"
          width={0}
          minWidth="100%"
        >
          by {author()}
          <Show when={isHiddenUpload(props.project)}>
            {' '}
            (upload hidden by the VGA library design of the same name)
          </Show>
        </Typography>
      </Stack>
    </Stack>
  );
}

/**
 * The projects matching a search, best first: over the title, the author, the
 * shuttle and the macro. A VGA library design's macro is its name on the board;
 * its Tiny Tapeout macro (`tt_um_...`, from the index) is searched too.
 */
export function filterProjects(projects: Project[], inputValue: string): Project[] {
  if (!inputValue) {
    return projects;
  }
  const searchable = projects.map((project) => ({
    project,
    title: project.title,
    author: project.author,
    shuttle: project.shuttle ?? '',
    macro: project.macro,
    ttMacro: project.source === 'library' ? (fpgaLibrary.byId[project.macro]?.macro ?? '') : '',
  }));
  return fuzzySort(inputValue, searchable, ['title', 'author', 'shuttle', 'macro', 'ttMacro']).map(
    (x) => x.item.project,
  );
}

/**
 * The picker's options for a set of matches: every ASIC project, demo and
 * upload, and at most PROJECT_LIMIT VGA library designs, in match order.
 * `libraryMatches` counts every library match, shown or not.
 */
export function capProjects(matches: Project[]) {
  let libraryMatches = 0;
  const options = matches.filter((p) => {
    if (p.source !== 'library') {
      return true;
    }
    libraryMatches += 1;
    return libraryMatches <= PROJECT_LIMIT;
  });
  return { options, libraryMatches };
}

/**
 * An upload whose name the board now resolves to a VGA library design: the
 * daemon would load the library design, so the upload cannot be picked.
 */
export function isHiddenUpload(project: Project) {
  return project.source === 'upload' && fpgaDesigns.byName[project.macro]?.source === 'library';
}

export function ProjectSelect(props: IProjectSelectProps) {
  // One fuzzy match per keystroke: the options and the count line share it.
  let cached: { projects: Project[]; input: string; result: ReturnType<typeof capProjects> };
  const matchesFor = (input: string) => {
    if (!cached || cached.projects !== props.projects || cached.input !== input) {
      cached = {
        projects: props.projects,
        input,
        result: capProjects(filterProjects(props.projects, input)),
      };
    }
    return cached.result;
  };

  const select = createSelect({
    // A library adds hundreds of designs: render at most PROJECT_LIMIT of them.
    options: (inputValue: string) => matchesFor(inputValue).options,
    isOptionDisabled: (option: Project) => isHiddenUpload(option),
    onChange: (value) => value && props.onSelect(value),
  });

  const libraryMatches = createMemo(() => matchesFor(select.inputValue()).libraryMatches);

  const fieldRef = createElementRef();

  createEffect(() => {
    select.setValue(props.selected);
    select.setInputValue('');
  });

  return (
    <>
      <TextField
        ref={fieldRef}
        label="Project"
        disabled={select.disabled}
        size="small"
        autoComplete="off"
        fullWidth
        InputLabelProps={{
          shrink: true,
          sx: { textTransform: 'capitalize' },
        }}
        sx={{
          '& .MuiInputBase-root': {
            flexWrap: 'wrap',
            padding: '6px 6px 6px 14px',
            background: 'white',
          },
          '& .MuiInputBase-input': {
            padding: '2.5px 0px',
            minWidth: 30,
            width: 0,
            flexGrow: 1,
            ...(select.isActive() ? {} : { caretColor: 'transparent' }),
          },
        }}
        onFocusIn={select.onFocusIn}
        onFocusOut={select.onFocusOut}
        onClick={() => !select.disabled && select.toggleOpen()}
        onChange={(_, value) => {
          select.setInputValue(value);
        }}
        onKeyDown={select.onKeyDown}
        value={(select.inputValue() || select.value()?.title) ?? ''}
      />

      <Popper
        open={select.isOpen()}
        anchorEl={fieldRef.ref}
        placement="bottom"
        onMouseDown={select.onMouseDown}
      >
        <Paper
          sx={{
            overflow: 'auto',
            minWidth: fieldRef.ref.clientWidth,
          }}
        >
          <List sx={{ maxHeight: '40vh', overflow: 'auto' }}>
            <For
              each={select.options()}
              fallback={
                <ListItem>
                  <ListItemText>No matching projects</ListItemText>
                </ListItem>
              }
            >
              {(option) => (
                <ListItemButton
                  onClick={() => select.pickOption(option)}
                  selected={select.isOptionFocused(option)}
                  disabled={select.isOptionDisabled(option)}
                >
                  <ListItemText
                    disableTypography
                    sx={{
                      '& mark': {
                        textDecoration: 'underline',
                        background: 'yellow',
                      },
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    <ProjectListItem project={option} search={select.inputValue()} />
                  </ListItemText>
                </ListItemButton>
              )}
            </For>
            <Show when={libraryMatches() > PROJECT_LIMIT}>
              <ListItem>
                <ListItemText
                  secondary={`showing ${PROJECT_LIMIT} of ${libraryMatches()} VGA library designs; type to narrow`}
                />
              </ListItem>
            </Show>
          </List>
        </Paper>
      </Popper>
    </>
  );
}
