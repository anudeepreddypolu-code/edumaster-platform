import re

with open('src/components/CoursesTab.tsx', 'r') as f:
    content = f.read()

# Replace `{selectedCourse ? (` with `) : (\n        <div className="space-y-5">\n          <div className="flex items-center justify-between">\n            <button\n              onClick={() => setSelectedCourseId(null)}\n              className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink-soft)] transition hover:border-[var(--ink)] hover:text-[var(--ink)]"\n            >\n              ← Back to courses\n            </button>\n          </div>`
target = "      {selectedCourse ? ("
replacement = """      ) : (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSelectedCourseId(null)}
              className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink-soft)] transition hover:border-[var(--ink)] hover:text-[var(--ink)]"
            >
              ← Back to courses
            </button>
          </div>"""

if target in content:
    content = content.replace(target, replacement)
    print("Replaced selectedCourse ?")
else:
    print("Target not found")
    exit(1)

# At the end of the file, we need to remove the fallback:
#       ) : (
#         <div className="rounded-[24px] border border-dashed border-[#dbe4ef] bg-white p-8 text-[#607089]">
#           Select a course to view modules, topics, and the lesson player.
#         </div>
#       )}

end_target = """      ) : (
        <div className="rounded-[24px] border border-dashed border-[#dbe4ef] bg-white p-8 text-[#607089]">
          Select a course to view modules, topics, and the lesson player.
        </div>
      )}
    </div>
  );
};"""

end_replacement = """        </div>
      )}
    </div>
  );
};"""

if end_target in content:
    content = content.replace(end_target, end_replacement)
    print("Replaced fallback")
else:
    print("End target not found")
    
with open('src/components/CoursesTab.tsx', 'w') as f:
    f.write(content)

