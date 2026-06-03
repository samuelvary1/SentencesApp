import { useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Settings,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

type JournalEntries = Record<string, string>;
type Mode = 'journal' | 'allEntries' | 'onThisDay';

const STORAGE_KEY = '@daily_journal_entries_v1';
const IOS_SETTINGS_FALLBACK_KEY = 'daily_journal_entries_v1';
const WEEK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function dateToKey(date: Date): string {
  return date.toISOString().split('T')[0];
}

function keyToDate(key: string): Date {
  return new Date(`${key}T12:00:00`);
}

function shiftDateKey(key: string, days: number): string {
  const date = keyToDate(key);
  date.setDate(date.getDate() + days);
  return dateToKey(date);
}

function formatKey(key: string): string {
  const date = keyToDate(key);
  const weekDay = WEEK_DAYS[date.getDay()];
  const month = MONTHS[date.getMonth()];
  return `${weekDay}, ${month} ${date.getDate()} ${date.getFullYear()}`;
}

function parseEntries(value: string | null): JournalEntries {
  if (!value) {
    return {};
  }

  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(parsed).filter(
      ([key, text]) => typeof key === 'string' && typeof text === 'string',
    ),
  );
}

async function readStoredEntries(): Promise<JournalEntries> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    return parseEntries(stored);
  } catch {
    if (Platform.OS === 'ios') {
      const fallbackValue = Settings.get(IOS_SETTINGS_FALLBACK_KEY);
      const fallbackString = typeof fallbackValue === 'string' ? fallbackValue : null;
      return parseEntries(fallbackString);
    }

    throw new Error('Storage unavailable');
  }
}

async function writeStoredEntries(nextEntries: JournalEntries): Promise<void> {
  const serialized = JSON.stringify(nextEntries);

  try {
    await AsyncStorage.setItem(STORAGE_KEY, serialized);
    return;
  } catch {
    if (Platform.OS === 'ios') {
      Settings.set({ [IOS_SETTINGS_FALLBACK_KEY]: serialized });
      return;
    }

    throw new Error('Storage unavailable');
  }
}

const TODAY_KEY = dateToKey(new Date());

function App() {
  const todayKey = TODAY_KEY;
  const [entries, setEntries] = useState<JournalEntries>({});
  const [selectedDateKey, setSelectedDateKey] = useState(todayKey);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<Mode>('journal');
  const [isEditing, setIsEditing] = useState(true);
  const [status, setStatus] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState('');

  useEffect(() => {
    const loadEntries = async () => {
      try {
        const loadedEntries = await readStoredEntries();
        setEntries(loadedEntries);
      } catch {
        setStatus('Could not load your entries.');
      }
    };

    loadEntries();
  }, []);

  // When date changes or entries load: sync draft and decide edit vs read-only
  useEffect(() => {
    const existing = entries[selectedDateKey]?.trim() ?? '';
    setDraft(existing);
    setStatus('');
    setIsEditing(!existing);
  }, [entries, selectedDateKey]);

  const onThisDayEntries = useMemo(() => {
    const selectedMonthDay = selectedDateKey.slice(5);
    return Object.entries(entries)
      .filter(([key, text]) => key.slice(5) === selectedMonthDay && text.trim())
      .sort(([a], [b]) => b.localeCompare(a));
  }, [entries, selectedDateKey]);

  const allEntries = useMemo(() => {
    return Object.entries(entries)
      .filter(([, text]) => text.trim())
      .sort(([a], [b]) => b.localeCompare(a));
  }, [entries]);

  const saveEntry = async () => {
    Keyboard.dismiss();
    const nextEntries: JournalEntries = { ...entries };
    const cleaned = draft.trim();

    if (cleaned) {
      nextEntries[selectedDateKey] = cleaned;
    } else {
      delete nextEntries[selectedDateKey];
    }

    try {
      await writeStoredEntries(nextEntries);
      setEntries(nextEntries);
      setStatus(cleaned ? 'Saved.' : 'Entry removed for this day.');
    } catch {
      setStatus('Could not save. Please try again.');
    }
  };

  const exportEntries = async () => {
    if (allEntries.length === 0 || isExporting) {
      return;
    }

    setIsExporting(true);
    setExportStatus('Preparing export...');

    try {
      const generatedAt = new Date();
      const exportText = [
        'Line-a-Day Journal Export',
        `Exported: ${generatedAt.toLocaleString()}`,
        '----------------------------------------',
        ...allEntries.flatMap(([key, text]) => [formatKey(key), text, '']),
      ].join('\n');

      await Share.share({
        title: 'Line-a-Day Journal Export',
        message: exportText,
      });

      setExportStatus('Export ready. Use the share sheet to save or send your entries.');
    } catch {
      setExportStatus('Could not export entries. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const navigateToEntry = (key: string) => {
    setSelectedDateKey(key);
    setMode('journal');
    // isEditing will be set to false by the useEffect since an entry exists
  };

  const hasEntryForSelected = Boolean(entries[selectedDateKey]?.trim());
  const isToday = selectedDateKey === todayKey;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <StatusBar barStyle="dark-content" backgroundColor={styles.safeArea.backgroundColor} />
        <View style={styles.container}>

          <View style={styles.header}>
            <Text style={styles.title}>Daily Lines 🌼</Text>
            <Text style={styles.subtitle}>One short entry per day.</Text>
          </View>

          {/* Tab bar */}
          <View style={styles.modeSwitch}>
            {(['journal', 'allEntries', 'onThisDay'] as Mode[]).map(tab => (
              <Pressable
                key={tab}
                onPress={() => setMode(tab)}
                style={[styles.modeButton, mode === tab && styles.modeButtonActive]}
              >
                <Text style={[styles.modeButtonText, mode === tab && styles.modeButtonTextActive]}>
                  {tab === 'journal' ? 'Journal' : tab === 'allEntries' ? 'All' : 'On This Day'}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Date navigation — only in Journal and On This Day tabs */}
          {mode !== 'allEntries' && (
            <>
              <View style={styles.dateRow}>
                <Pressable
                  onPress={() => setSelectedDateKey(prev => shiftDateKey(prev, -1))}
                  style={styles.smallAction}
                >
                  <Text style={styles.smallActionText}>{'<'}</Text>
                </Pressable>

                <View style={styles.dateLabelWrap}>
                  <Text style={styles.dateLabel}>{formatKey(selectedDateKey)}</Text>
                  <Text style={styles.dateHint}>
                    {hasEntryForSelected ? 'Entry exists' : 'No entry yet'}
                  </Text>
                </View>

                <Pressable
                  onPress={() => setSelectedDateKey(prev => shiftDateKey(prev, 1))}
                  style={styles.smallAction}
                >
                  <Text style={styles.smallActionText}>{'>'}</Text>
                </Pressable>
              </View>

              {!isToday && (
                <Pressable
                  onPress={() => setSelectedDateKey(todayKey)}
                  style={styles.todayButton}
                >
                  <Text style={styles.todayButtonText}>Jump to Today</Text>
                </Pressable>
              )}
            </>
          )}

          {/* ── Journal tab ── */}
          {mode === 'journal' && (
            <>
              {hasEntryForSelected && !isEditing ? (
                // Read-only view
                <>
                  <View style={styles.readOnlyCard}>
                    {isToday && (
                      <Text style={styles.doneHeading}>🎉 All done for today!</Text>
                    )}
                    <Text style={styles.readOnlyText}>{entries[selectedDateKey]}</Text>
                    <Pressable onPress={() => setIsEditing(true)} style={styles.editButton}>
                      <Text style={styles.editButtonText}>Edit Entry</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                // Edit view
                <>
                  <TextInput
                    multiline
                    value={draft}
                    onChangeText={setDraft}
                    placeholder="What happened today?"
                    placeholderTextColor="#9B9389"
                    style={styles.input}
                    textAlignVertical="top"
                    autoFocus={!hasEntryForSelected}
                  />

                  <View style={styles.editRow}>
                    <Pressable onPress={saveEntry} style={styles.saveButton}>
                      <Text style={styles.saveButtonText}>Save Entry</Text>
                    </Pressable>

                    {hasEntryForSelected && (
                      <Pressable
                        onPress={() => {
                          Keyboard.dismiss();
                          setDraft(entries[selectedDateKey] ?? '');
                          setIsEditing(false);
                        }}
                        style={styles.cancelButton}
                      >
                        <Text style={styles.cancelButtonText}>Cancel</Text>
                      </Pressable>
                    )}
                  </View>

                  <Text style={styles.statusText}>{status || ' '}</Text>
                </>
              )}
            </>
          )}

          {/* ── All Entries tab ── */}
          {mode === 'allEntries' && (
            <>
              <View style={styles.exportRow}>
                <Text style={styles.sectionTitle}>All Entries 🌸</Text>
                <Pressable
                  onPress={exportEntries}
                  style={[styles.exportButton, (isExporting || allEntries.length === 0) && styles.exportButtonDisabled]}
                  disabled={isExporting || allEntries.length === 0}
                >
                  <Text style={styles.exportButtonText}>
                    {isExporting ? 'Exporting...' : 'Export'}
                  </Text>
                </Pressable>
              </View>
              <Text style={styles.exportStatusText}>{exportStatus || ' '}</Text>
              <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
                {allEntries.length === 0 ? (
                  <Text style={styles.emptyText}>Your entries will appear here.</Text>
                ) : (
                  allEntries.map(([key, text]) => (
                    <Pressable
                      key={key}
                      onPress={() => navigateToEntry(key)}
                      style={styles.listCard}
                    >
                      <Text style={styles.listDate}>{formatKey(key)}</Text>
                      <Text style={styles.listPreview} numberOfLines={2}>
                        {text}
                      </Text>
                    </Pressable>
                  ))
                )}
              </ScrollView>
            </>
          )}

          {/* ── On This Day tab ── */}
          {mode === 'onThisDay' && (
            <>
              <Text style={styles.sectionTitle}>On This Day Across Years 🌼</Text>
              <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
                {onThisDayEntries.length === 0 ? (
                  <Text style={styles.emptyText}>No entries yet for this day in any year.</Text>
                ) : (
                  onThisDayEntries.map(([key, text]) => (
                    <Pressable
                      key={key}
                      onPress={() => navigateToEntry(key)}
                      style={styles.listCard}
                    >
                      <Text style={styles.listDate}>{formatKey(key)}</Text>
                      <Text style={styles.listPreview}>{text}</Text>
                    </Pressable>
                  ))
                )}
              </ScrollView>
            </>
          )}

        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFF1E6',
  },
  container: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 12,
  },
  header: {
    marginBottom: 14,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    color: '#5A2400',
    letterSpacing: 0.3,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    color: '#985A2B',
  },
  modeSwitch: {
    flexDirection: 'row',
    backgroundColor: '#FFD9BD',
    borderRadius: 12,
    padding: 4,
    marginBottom: 12,
  },
  modeButton: {
    flex: 1,
    borderRadius: 9,
    paddingVertical: 8,
    alignItems: 'center',
  },
  modeButtonActive: {
    backgroundColor: '#FFF9F3',
  },
  modeButtonText: {
    color: '#8B4A1F',
    fontWeight: '600',
    fontSize: 13,
  },
  modeButtonTextActive: {
    color: '#5A2400',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  dateLabelWrap: {
    flex: 1,
    alignItems: 'center',
  },
  dateLabel: {
    color: '#5A2400',
    fontSize: 16,
    fontWeight: '600',
  },
  dateHint: {
    marginTop: 2,
    color: '#A8683A',
    fontSize: 12,
  },
  smallAction: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFCFAA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallActionText: {
    fontSize: 19,
    color: '#6A2D06',
    fontWeight: '600',
  },
  todayButton: {
    alignSelf: 'center',
    marginBottom: 10,
  },
  todayButtonText: {
    color: '#A24F1F',
    fontSize: 13,
    fontWeight: '600',
  },
  // Read-only state
  readOnlyCard: {
    backgroundColor: '#FFF9F2',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#F0B689',
    padding: 16,
    marginTop: 6,
  },
  doneHeading: {
    fontSize: 17,
    fontWeight: '700',
    color: '#5A2400',
    marginBottom: 8,
  },
  readOnlyText: {
    fontSize: 16,
    color: '#3A1800',
    lineHeight: 24,
    marginBottom: 2,
  },
  editButton: {
    marginTop: 14,
    borderWidth: 1.5,
    borderColor: '#C4571E',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  editButtonText: {
    color: '#C4571E',
    fontWeight: '700',
    fontSize: 15,
  },
  // Edit state
  input: {
    minHeight: 170,
    maxHeight: 250,
    backgroundColor: '#FFF9F2',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#F0B689',
    padding: 14,
    fontSize: 16,
    color: '#5A2400',
    lineHeight: 22,
    marginTop: 6,
  },
  editRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  saveButton: {
    flex: 1,
    backgroundColor: '#C4571E',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#FFF8F0',
    fontWeight: '700',
    fontSize: 15,
  },
  cancelButton: {
    borderWidth: 1.5,
    borderColor: '#C4571E',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#C4571E',
    fontWeight: '600',
    fontSize: 15,
  },
  statusText: {
    minHeight: 20,
    marginTop: 8,
    color: '#9C4D1E',
    fontSize: 13,
  },
  sectionTitle: {
    marginTop: 6,
    marginBottom: 8,
    color: '#6F2E0A',
    fontWeight: '700',
    fontSize: 14,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  exportRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  exportButton: {
    backgroundColor: '#C4571E',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  exportButtonDisabled: {
    backgroundColor: '#D8A07E',
  },
  exportButtonText: {
    color: '#FFF8F0',
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 0.3,
  },
  exportStatusText: {
    minHeight: 20,
    color: '#9C4D1E',
    fontSize: 13,
    marginBottom: 2,
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: 8,
    paddingBottom: 16,
  },
  listCard: {
    backgroundColor: '#FFFDF9',
    borderWidth: 1,
    borderColor: '#F3C7A3',
    borderRadius: 12,
    padding: 11,
  },
  listDate: {
    color: '#93461A',
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 4,
  },
  listPreview: {
    color: '#5A2400',
    fontSize: 14,
    lineHeight: 20,
  },
  emptyText: {
    color: '#A05A2C',
    fontSize: 14,
    paddingVertical: 12,
  },
});

export default App;
