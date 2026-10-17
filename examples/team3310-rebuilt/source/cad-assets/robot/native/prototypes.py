"""Unplaced native asset catalog for mesh export and geometry inspection."""
import models

def build(ctx):
    catalog,nodes,shapes=models.prototypes(ctx)
    return [{'id':key,'name':catalog[key]['name'],'color':'#aab3bd','shape':shape} for key,shape in shapes.items()]
