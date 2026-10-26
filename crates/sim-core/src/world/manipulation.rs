//! Finite-force virtual fixture. Never teleports cargo or supplies a launch.
use super::*;

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum ManipulationCommand {
    Move { id: String, position: [f32;3], frame: Option<String>, duration: f32,
        max_force: f32, max_speed: f32, #[serde(default)] hold_seconds: f32 },
    Release { id: String },
    RestoreGameplay { id: String },
    Status,
}
#[derive(Default)]
pub(super) struct Runtime {
    active: BTreeMap<String, Grip>,
    physical_only: std::collections::BTreeSet<String>,
}
struct Grip {
    start: Vector, end: Vector, frame: Option<String>, started: f64,
    duration: f32, hold: f32, max_force: f32, max_speed: f32,
    error: f32, force: Vector,
}
impl World {
    pub fn manipulate_game_piece(&mut self, command: ManipulationCommand) -> Result<serde_json::Value> {
        match command {
            ManipulationCommand::Status => {},
            ManipulationCommand::Release { id } => {
                ensure!(self.body_ids.contains_key(&id), "unknown body");
                self.manipulation.active.remove(&id);
            },
            ManipulationCommand::RestoreGameplay { id } => {
                ensure!(!self.manipulation.active.contains_key(&id), "release before restoring gameplay");
                ensure!(self.body_ids.contains_key(&id), "unknown body");
                self.manipulation.physical_only.remove(&id);
            },
            ManipulationCommand::Move {id,position,frame,duration,max_force,max_speed,hold_seconds} => {
                let spec = self.spec.bodies.iter().find(|b|b.id==id).context("unknown body")?;
                ensure!(!spec.fixed && !self.spec.joints.iter().any(|j|j.parent==id||j.child==id), "requires a free dynamic body");
                ensure!(position.iter().all(|x|x.is_finite()), "nonfinite position");
                ensure!(duration.is_finite() && duration>0.0 && duration<=60.0, "duration must be in (0,60] seconds");
                ensure!(hold_seconds.is_finite() && (0.0..=60.0).contains(&hold_seconds), "hold_seconds must be in [0,60]");
                ensure!(max_force.is_finite() && max_force>0.0 && max_force<=1000.0, "max_force must be in (0,1000] newtons");
                ensure!(max_speed.is_finite() && max_speed>0.0 && max_speed<=10.0, "max_speed must be in (0,10] metres/second");
                let (center, _, _) = self.manipulation_body_state(&id);
                let mut start=center;
                if let Some(f)=&frame {
                    ensure!(*f!=id, "body cannot be its own frame");
                    let body=self.spec.bodies.iter().find(|b|b.id==*f).context("unknown frame")?;
                    ensure!(body.compliance.is_none(), "frame must be rigid");
                    start=self.bodies[self.body_ids[f]].position().inverse()*center;
                }
                ensure!((Vector::from(position)-start).length()/duration <= max_speed, "path exceeds max_speed; increase duration");
                // All validation precedes ownership changes. Keep deformation and velocity.
                self.release_practice_piece(&id);
                self.release_field_cargo(&id);
                let handle=self.game_piece_handle(&id);
                self.bodies[handle].set_enabled(true);
                self.bodies[handle].enable_ccd(true);
                self.manipulation.physical_only.insert(id.clone());
                self.manipulation.active.insert(id, Grip {start,end:position.into(),frame,
                    started:self.tick as f64*self.spec.dt as f64,duration,hold:hold_seconds,max_force,max_speed,
                    error:0.0,force:Vector::ZERO});
            }
        }
        Ok(self.manipulation_status())
    }
    pub(super) fn physical_only(&self,id:&str)->bool { self.manipulation.physical_only.contains(id) }
    pub(super) fn manipulation_status(&self)->serde_json::Value {
        serde_json::json!({"physicalOnly":self.manipulation.physical_only,"active":self.manipulation.active.iter().map(|(id,g)|
            (id.clone(),serde_json::json!({"trackingErrorM":g.error,"appliedForceN":g.force.to_array(),
                "releaseTime":g.started+(g.duration+g.hold) as f64}))).collect::<BTreeMap<_,_>>()})
    }
    pub(super) fn manipulation_step(&mut self,dt:f32,time:f64) {
        let ids:Vec<_>=self.manipulation.active.keys().cloned().collect();
        for id in ids {
            let g=&self.manipulation.active[&id];
            let age=(time-g.started) as f32;
            if age>=g.duration+g.hold {self.manipulation.active.remove(&id);continue;}
            let mut target=g.start.lerp(g.end,(age/g.duration).clamp(0.0,1.0));
            let mut velocity=if age<g.duration {(g.end-g.start)/g.duration} else {Vector::ZERO};
            if let Some(f)=&g.frame {
                let b=&self.bodies[self.body_ids[f]];
                target=*b.position()*target;
                velocity=b.position().rotation*velocity+b.linvel()+b.angvel().cross(target-b.center_of_mass());
            }
            let (position,current,mass)=self.manipulation_body_state(&id);
            let error=target-position;
            // Velocity servo with bounded force; collisions can prevent target tracking.
            let desired=(velocity+error*10.0).clamp_length_max(g.max_speed);
            let force=((desired-current)*mass*20.0-Vector::from(self.spec.gravity)*mass).clamp_length_max(g.max_force);
            self.manipulation_impulse(&id,force*dt);
            let g=self.manipulation.active.get_mut(&id).unwrap();
            g.error=error.length();g.force=force;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn world(wall:bool)->World {
        let mut value=json!({"gravity":[0,0,0],"bodies":[
            {"id":"ball","position":[0,0,0],"mass":1,"colliders":[{"kind":"ball","radius":0.05,"center":[0,0,0]}]}
        ]});
        if wall {value["bodies"].as_array_mut().unwrap().push(json!({"id":"wall","fixed":true,"position":[0.3,0,0],"colliders":[{"kind":"box","half":[0.05,1,1],"center":[0,0,0]}]}));}
        World::new(serde_json::from_value(value).unwrap()).unwrap()
    }
    fn request(position:[f32;3],duration:f32)->ManipulationCommand {
        ManipulationCommand::Move {id:"ball".into(),position,frame:None,duration,max_force:5.0,max_speed:0.5,hold_seconds:0.5}
    }
    fn step(w:&mut World,n:usize){ w.step(&serde_json::from_value(json!({"steps":n,"volts":{}})).unwrap()).unwrap(); }
    #[test] fn virtual_hand_moves_then_releases_without_changing_velocity() {
        let mut w=world(false);
        w.manipulate_game_piece(request([0.4,0.0,0.0],1.0)).unwrap();
        assert_eq!(w.bodies[w.body_ids["ball"]].translation(),Vector::ZERO);
        step(&mut w,160);
        let b=&w.bodies[w.body_ids["ball"]];
        assert!(b.translation().x>0.2 && b.translation().x<0.4);
        let v=b.linvel();let p=b.translation();
        w.manipulate_game_piece(ManipulationCommand::Release{id:"ball".into()}).unwrap();
        assert_eq!(w.bodies[w.body_ids["ball"]].linvel(),v);
        assert_eq!(w.bodies[w.body_ids["ball"]].translation(),p);
        assert!(w.physical_only("ball"));
        w.manipulate_game_piece(ManipulationCommand::RestoreGameplay{id:"ball".into()}).unwrap();
        assert!(!w.physical_only("ball"));
    }
    #[test] fn virtual_hand_cannot_teleport_through_wall_and_auto_releases() {
        let mut w=world(true);
        w.manipulate_game_piece(request([0.5,0.0,0.0],2.0)).unwrap();
        step(&mut w,450);
        assert!(w.bodies[w.body_ids["ball"]].translation().x<0.22);
        let status=w.manipulation_status();
        assert!(status["active"]["ball"]["trackingErrorM"].as_f64().unwrap()>0.25);
        let force=w.manipulation.active["ball"].force.length();assert!(force<=5.00001);
        step(&mut w,60);
        assert!(w.manipulation.active.is_empty());assert!(w.physical_only("ball"));
    }
    #[test] fn invalid_grip_does_not_replace_active_command() {
        let mut w=world(false);
        w.manipulate_game_piece(request([0.2,0.0,0.0],1.0)).unwrap();
        assert!(w.manipulate_game_piece(request([2.0,0.0,0.0],1.0)).is_err());
        assert_eq!(w.manipulation.active["ball"].end,Vector::new(0.2,0.0,0.0));
        assert!(w.manipulate_game_piece(request([f32::NAN,0.0,0.0],1.0)).is_err());
    }
}
