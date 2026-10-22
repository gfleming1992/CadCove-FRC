// Text imports are compiled into the standalone CLI. No source checkout,
// network service or AI provider is needed to initialize a team's instructions.
import workflow from '../agent-skills/frc-workflow/SKILL.md' with {type:'text'};
import cad from '../agent-skills/frc-cad-mechanisms/SKILL.md' with {type:'text'};
import controls from '../agent-skills/frc-ctre-controls/SKILL.md' with {type:'text'};
import vision from '../agent-skills/frc-vision/SKILL.md' with {type:'text'};
import rules from '../agent-skills/frc-season-rules/SKILL.md' with {type:'text'};
import validation from '../agent-skills/frc-simulation-validation/SKILL.md' with {type:'text'};
import components from '../agent-skills/references/frc-components.md' with {type:'text'};
import authoring from '../agent-skills/references/cad-authoring.md' with {type:'text'};
import sheetMetal from '../docs/CAD-SHEET-METAL.md' with {type:'text'};
import flatExport from '../docs/CAD-FLAT-EXPORT.md' with {type:'text'};
import drawings from '../docs/CAD-DRAWINGS.md' with {type:'text'};
import nativeCad from '../agent-skills/references/native-cadquery.md' with {type:'text'};
import physics from '../agent-skills/references/physics-authoring.md' with {type:'text'};
import physicsExample from '../agent-skills/references/physics-world-example.json' with {type:'text'};
import season from '../seasons/2026/season.json';

export function agentGuidanceFiles(){
 const files={};
 for(const [name,text] of Object.entries({'frc-workflow':workflow,'frc-cad-mechanisms':cad,'frc-ctre-controls':controls,'frc-vision':vision,'frc-season-rules':rules,'frc-simulation-validation':validation}))files[`.cadcove/skills/${name}/SKILL.md`]=text;
 files['.cadcove/skills/references/frc-components.md']=components;
 files['.cadcove/skills/references/cad-authoring.md']=authoring;
 files['.cadcove/skills/references/native-cadquery.md']=nativeCad;
 files['.cadcove/skills/references/cad-drawings.md']=drawings;
 files['.cadcove/skills/references/cad-flat-export.md']=flatExport;
 files['.cadcove/skills/references/cad-sheet-metal.md']=sheetMetal;
 files['.cadcove/skills/references/physics-authoring.md']=physics;
 files['.cadcove/skills/references/physics-world-example.json']=physicsExample;
 files['.cadcove/seasons/2026.json']=JSON.stringify(season,null,2)+'\n';
 files['.cadcove/frc.json']=JSON.stringify({schema:1,example:null,seasonKnowledge:null,componentPreference:['CTRE Phoenix 6','WCP','Limelight'],note:'Select this robot and season explicitly. Preferences do not override the team BOM or imply adapter support.'},null,2)+'\n';
 files['.cadcove/knowledge/.gitignore']='*\n!.gitignore\n';
 return files;
}
